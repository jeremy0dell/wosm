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
import {
  PROTOCOL_SCHEMA_VERSION,
  ProtocolEventEnvelopeSchema,
  type ProtocolMethod,
  ProtocolRequestSchema,
  ProtocolResponseSchema,
} from "./messages.js";
import { connectUnixSocket } from "./transport.js";

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
  } finally {
    connection.close();
  }

  throw new Error("Observer socket closed before a protocol response arrived.");
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

    let subscribed = false;
    for await (const message of connection.messages()) {
      if (!subscribed) {
        const response = ProtocolResponseSchema.parse(message);
        if ("error" in response) {
          throw response.error;
        }
        subscribed = true;
        continue;
      }
      const envelope = ProtocolEventEnvelopeSchema.parse(message);
      yield WosmEventSchema.parse(envelope.event);
    }
  } finally {
    connection.close();
  }
}
