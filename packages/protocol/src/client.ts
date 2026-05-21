import type {
  CommandId,
  CommandReceipt,
  CommandRecord,
  DiagnosticCollectionOptions,
  DiagnosticSnapshot,
  DoctorOptions,
  DoctorReport,
  EventFilter,
  HookReceipt,
  ObserverHealth,
  ObserverStopReceipt,
  ProviderHookEvent,
  ReconcileReceipt,
  WosmCommand,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";
import {
  CommandReceiptSchema,
  CommandRecordSchema,
  DiagnosticSnapshotSchema,
  DoctorReportSchema,
  HookReceiptSchema,
  ObserverHealthSchema,
  ObserverStopReceiptSchema,
  ReconcileReceiptSchema,
  WosmEventSchema,
  WosmSnapshotSchema,
} from "@wosm/contracts";
import { runRuntimeBoundaryWithTimeout } from "@wosm/runtime";
import {
  PROTOCOL_SCHEMA_VERSION,
  ProtocolEventEnvelopeSchema,
  type ProtocolMethod,
  ProtocolRequestSchema,
  ProtocolResponseSchema,
  protocolSafeError,
} from "./messages.js";
import { connectUnixSocket, type NdjsonConnection } from "./transport.js";

export type ObserverClient = {
  health(): Promise<ObserverHealth>;
  stop(): Promise<ObserverStopReceipt>;
  getSnapshot(options?: { includeDebug?: boolean }): Promise<WosmSnapshot>;
  subscribe(filter?: EventFilter): AsyncIterable<WosmEvent>;
  dispatch(command: WosmCommand): Promise<CommandReceipt>;
  getCommand(commandId: CommandId): Promise<CommandRecord | undefined>;
  reconcile(reason?: string): Promise<ReconcileReceipt>;
  ingestHookEvent(event: ProviderHookEvent): Promise<HookReceipt>;
  runDoctor(options?: DoctorOptions): Promise<DoctorReport>;
  collectDiagnostics(options?: DiagnosticCollectionOptions): Promise<DiagnosticSnapshot>;
};

export type CreateObserverClientOptions = {
  socketPath: string;
  timeoutMs?: number;
  requestId?: () => string;
};

const defaultRequestId = () => `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function createObserverClient(options: CreateObserverClientOptions): ObserverClient {
  const requestId = options.requestId ?? defaultRequestId;

  return {
    health: async () =>
      ObserverHealthSchema.parse(await call(options, requestId(), "observer.health")),
    stop: async () =>
      ObserverStopReceiptSchema.parse(await call(options, requestId(), "observer.stop")),
    getSnapshot: async (params) =>
      WosmSnapshotSchema.parse(await call(options, requestId(), "snapshot.get", params)),
    dispatch: async (command) =>
      CommandReceiptSchema.parse(await call(options, requestId(), "command.dispatch", { command })),
    getCommand: async (commandId) => {
      const result = await call(options, requestId(), "command.get", { commandId });
      return result === null ? undefined : CommandRecordSchema.parse(result);
    },
    reconcile: async (reason) =>
      ReconcileReceiptSchema.parse(
        await call(
          options,
          requestId(),
          "observer.reconcile",
          reason === undefined ? undefined : { reason },
        ),
      ),
    ingestHookEvent: async (event) =>
      HookReceiptSchema.parse(
        await call(options, requestId(), "observer.ingestHookEvent", { event }),
      ),
    runDoctor: async (params) =>
      DoctorReportSchema.parse(await call(options, requestId(), "doctor.run", params)),
    collectDiagnostics: async (params) =>
      DiagnosticSnapshotSchema.parse(
        await call(options, requestId(), "diagnostics.collect", params),
      ),
    subscribe: (filter) => subscribe(options, requestId(), filter),
  };
}

async function call(
  options: CreateObserverClientOptions,
  id: string,
  method: ProtocolMethod,
  params?: unknown,
): Promise<unknown> {
  const result = await runRuntimeBoundaryWithTimeout(
    {
      operation: `protocol.client.${method}`,
      timeoutMs: requestTimeoutMs(options),
      error: protocolSafeError({
        code: "PROTOCOL_REQUEST_FAILED",
        message: "Observer protocol request failed.",
      }),
      timeoutError: protocolSafeError({
        tag: "TimeoutError",
        code: "PROTOCOL_REQUEST_TIMEOUT",
        message: "Observer protocol request timed out.",
      }),
    },
    async ({ signal }: { signal: AbortSignal }) => {
      const connection = await connectUnixSocket(
        options.socketPath,
        options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
      );
      try {
        return await withConnectionAbort(connection, signal, async () => {
          connection.send(
            ProtocolRequestSchema.parse({
              schemaVersion: PROTOCOL_SCHEMA_VERSION,
              jsonrpc: "2.0",
              id,
              method,
              ...(params === undefined ? {} : { params }),
            }),
          );

          for await (const message of connection.messages()) {
            const response = ProtocolResponseSchema.parse(message);
            if (response.id !== id) {
              continue;
            }
            if ("error" in response) {
              throw response.error;
            }
            return response.result;
          }

          throw protocolSafeError({
            code: "PROTOCOL_SOCKET_CLOSED",
            message: "Observer socket closed before a protocol response arrived.",
          });
        });
      } finally {
        connection.close();
      }
    },
  );

  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

async function* subscribe(
  options: CreateObserverClientOptions,
  id: string,
  filter?: EventFilter,
): AsyncIterable<WosmEvent> {
  const connection = await connectUnixSocket(
    options.socketPath,
    options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
  );
  try {
    connection.send(
      ProtocolRequestSchema.parse({
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        jsonrpc: "2.0",
        id,
        method: "events.subscribe",
        ...(filter === undefined ? {} : { params: filter }),
      }),
    );

    const iterator = connection.messages()[Symbol.asyncIterator]();
    const ack = await nextProtocolMessage(connection, iterator, {
      timeoutMs: requestTimeoutMs(options),
      code: "PROTOCOL_SUBSCRIBE_TIMEOUT",
      message: "Observer protocol subscription acknowledgement timed out.",
    });
    const response = ProtocolResponseSchema.parse(ack);
    if ("error" in response) {
      throw response.error;
    }

    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        return;
      }
      const message = next.value;
      const envelope = ProtocolEventEnvelopeSchema.parse(message);
      yield WosmEventSchema.parse(envelope.event);
    }
  } finally {
    connection.close();
  }
}

function requestTimeoutMs(options: CreateObserverClientOptions): number {
  return options.timeoutMs ?? 5000;
}

async function nextProtocolMessage(
  connection: NdjsonConnection,
  iterator: AsyncIterator<unknown>,
  timeout: { timeoutMs: number; code: string; message: string },
): Promise<unknown> {
  const result = await runRuntimeBoundaryWithTimeout(
    {
      operation: "protocol.client.nextMessage",
      timeoutMs: timeout.timeoutMs,
      error: protocolSafeError({
        code: "PROTOCOL_READ_FAILED",
        message: "Observer protocol read failed.",
      }),
      timeoutError: protocolSafeError({
        tag: "TimeoutError",
        code: timeout.code,
        message: timeout.message,
      }),
    },
    async ({ signal }: { signal: AbortSignal }) =>
      withConnectionAbort(connection, signal, async () => {
        const next = await iterator.next();
        if (next.done) {
          throw protocolSafeError({
            code: "PROTOCOL_SOCKET_CLOSED",
            message: "Observer socket closed before a protocol response arrived.",
          });
        }
        return next.value;
      }),
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

async function withConnectionAbort<T>(
  connection: NdjsonConnection,
  signal: AbortSignal,
  task: () => Promise<T>,
): Promise<T> {
  const abort = () => connection.close();
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }
  try {
    return await task();
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
