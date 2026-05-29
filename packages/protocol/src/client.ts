import type {
  CommandId,
  CommandRecord,
  DiagnosticCollectionOptions,
  DoctorOptions,
  EventFilter,
  HarnessEventReport,
  ProviderHookEvent,
  WosmCommand,
  WosmEvent,
} from "@wosm/contracts";
import { WosmEventSchema } from "@wosm/contracts";
import { runRuntimeBoundaryWithTimeout } from "@wosm/runtime";
import type { z } from "zod";
import type { ObserverApi } from "./api.js";
import {
  ProtocolEventEnvelopeSchema,
  type ProtocolMethod,
  ProtocolResponseSchema,
  ProtocolResultSchemas,
  protocolRequest,
  protocolSafeError,
  protocolSocketClosedError,
} from "./messages.js";
import { unwrapBoundaryResult } from "./runtime.js";
import { connectUnixSocket, type NdjsonConnection } from "./transport.js";

type ProtocolResult<TMethod extends ProtocolMethod> = z.infer<
  (typeof ProtocolResultSchemas)[TMethod]
>;

export type CreateObserverClientOptions = {
  socketPath: string;
  timeoutMs?: number;
  requestId?: () => string;
};

const defaultRequestId = () => `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function createObserverClient(options: CreateObserverClientOptions): ObserverApi {
  const requestId = options.requestId ?? defaultRequestId;

  return {
    health: async () => call(options, requestId(), "observer.health"),
    stop: async () => call(options, requestId(), "observer.stop"),
    getSnapshot: async (params) => call(options, requestId(), "snapshot.get", params),
    dispatch: async (command: WosmCommand) =>
      call(options, requestId(), "command.dispatch", { command }),
    getCommand: async (commandId: CommandId) => {
      const result = await call(options, requestId(), "command.get", { commandId });
      return result === null ? undefined : (result satisfies CommandRecord);
    },
    reconcile: async (reason?: string) =>
      call(
        options,
        requestId(),
        "observer.reconcile",
        reason === undefined ? undefined : { reason },
      ),
    ingestHookEvent: async (event: ProviderHookEvent) =>
      call(options, requestId(), "observer.ingestHookEvent", { event }),
    reportHarnessEvent: async (report: HarnessEventReport) =>
      call(options, requestId(), "observer.harnessEvent.report", { report }),
    runDoctor: async (params?: DoctorOptions) => call(options, requestId(), "doctor.run", params),
    collectDiagnostics: async (params?: DiagnosticCollectionOptions) =>
      call(options, requestId(), "diagnostics.collect", params),
    subscribe: (filter?: EventFilter) => subscribe(options, requestId(), filter),
  };
}

async function call<TMethod extends ProtocolMethod>(
  options: CreateObserverClientOptions,
  id: string,
  method: TMethod,
  params?: unknown,
): Promise<ProtocolResult<TMethod>> {
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
          connection.send(protocolRequest(id, method, params));

          for await (const message of connection.messages()) {
            const response = ProtocolResponseSchema.parse(message);
            if (response.id !== id) {
              continue;
            }
            if ("error" in response) {
              throw response.error;
            }
            return ProtocolResultSchemas[method].parse(response.result) as ProtocolResult<TMethod>;
          }

          throw protocolSocketClosedError();
        });
      } finally {
        connection.close();
      }
    },
  );

  return unwrapBoundaryResult(result);
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
    connection.send(protocolRequest(id, "events.subscribe", filter));

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
          throw protocolSocketClosedError();
        }
        return next.value;
      }),
  );
  return unwrapBoundaryResult(result);
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
