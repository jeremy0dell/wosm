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
import { SafeErrorSchema } from "@wosm/contracts";
import { Effect, runRuntimeBoundaryWithTimeout } from "@wosm/runtime";
import {
  CommandDispatchParamsSchema,
  CommandGetParamsSchema,
  DiagnosticsCollectParamsSchema,
  DoctorRunParamsSchema,
  EventsSubscribeParamsSchema,
  HookIngestParamsSchema,
  PROTOCOL_SCHEMA_VERSION,
  ProtocolEventEnvelopeSchema,
  type ProtocolRequest,
  ProtocolRequestSchema,
  ProtocolResponseSchema,
  ProtocolResultSchemas,
  protocolSafeError,
  ReconcileParamsSchema,
  SnapshotGetParamsSchema,
} from "./messages.js";
import { listenUnixSocket, type NdjsonConnection, type UnixSocketServer } from "./transport.js";

export type ObserverApi = {
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

export type ProtocolServerOptions = {
  socketPath: string;
  api: ObserverApi;
  requestTimeoutMs?: number;
};

export async function startProtocolServer(
  options: ProtocolServerOptions,
): Promise<UnixSocketServer> {
  return listenUnixSocket({
    socketPath: options.socketPath,
    onConnection: (connection) =>
      handleConnection(connection, options.api, options.requestTimeoutMs ?? 5000),
  });
}

async function handleConnection(
  connection: NdjsonConnection,
  api: ObserverApi,
  requestTimeoutMs: number,
): Promise<void> {
  try {
    for await (const message of connection.messages()) {
      const request = ProtocolRequestSchema.safeParse(message);
      if (!request.success) {
        connection.send(errorResponse(requestId(message), "Invalid protocol request."));
        continue;
      }
      await routeRequest(connection, api, request.data, requestTimeoutMs);
    }
  } catch {
    connection.close();
  }
}

async function routeRequest(
  connection: NdjsonConnection,
  api: ObserverApi,
  request: ProtocolRequest,
  requestTimeoutMs: number,
): Promise<void> {
  if (request.method === "events.subscribe") {
    await routeSubscriptionRequest(connection, api, request);
    return;
  }

  const result = await runRuntimeBoundaryWithTimeout(
    {
      operation: `protocol.server.${request.method}`,
      timeoutMs: requestTimeoutMs,
      error: protocolSafeError({
        code: "PROTOCOL_HANDLER_FAILED",
        message: "Observer protocol method failed.",
      }),
      timeoutError: protocolSafeError({
        tag: "TimeoutError",
        code: "PROTOCOL_HANDLER_TIMEOUT",
        message: "Observer protocol method timed out.",
      }),
    },
    async () => routeSingleResponseRequest(api, request),
  );
  if (!result.ok) {
    connection.send(errorResponse(request.id, "Observer protocol method failed.", result.error));
    return;
  }
  try {
    sendResult(connection, request.id, request.method, result.value);
  } catch (error) {
    connection.send(
      errorResponse(request.id, "Observer protocol response validation failed.", error),
    );
  }
}

async function routeSingleResponseRequest(
  api: ObserverApi,
  request: ProtocolRequest,
): Promise<unknown> {
  try {
    switch (request.method) {
      case "observer.health": {
        return await api.health();
      }
      case "observer.stop": {
        return await api.stop();
      }
      case "snapshot.get": {
        const params = SnapshotGetParamsSchema.parse(request.params);
        return await api.getSnapshot(
          params?.includeDebug === undefined ? undefined : { includeDebug: params.includeDebug },
        );
      }
      case "command.dispatch": {
        const params = CommandDispatchParamsSchema.parse(request.params);
        return await api.dispatch(params.command);
      }
      case "command.get": {
        const params = CommandGetParamsSchema.parse(request.params);
        return (await api.getCommand(params.commandId)) ?? null;
      }
      case "observer.reconcile": {
        const params = ReconcileParamsSchema.parse(request.params);
        return await api.reconcile(params?.reason);
      }
      case "observer.ingestHookEvent": {
        const params = HookIngestParamsSchema.parse(request.params);
        return await api.ingestHookEvent(params.event);
      }
      case "doctor.run": {
        const params = DoctorRunParamsSchema.parse(request.params);
        return await api.runDoctor(params);
      }
      case "diagnostics.collect": {
        const params = DiagnosticsCollectParamsSchema.parse(request.params);
        return await api.collectDiagnostics(params);
      }
    }
  } catch (error) {
    throw protocolSafeErrorFromUnknown(error);
  }
}

async function routeSubscriptionRequest(
  connection: NdjsonConnection,
  api: ObserverApi,
  request: ProtocolRequest,
): Promise<void> {
  try {
    const params = EventsSubscribeParamsSchema.parse(request.params);
    sendResult(connection, request.id, "events.subscribe", { subscribed: true });
    await streamEvents(connection, api.subscribe(params));
  } catch (error) {
    connection.send(errorResponse(request.id, "Observer protocol method failed.", error));
  }
}

function sendResult(
  connection: NdjsonConnection,
  id: string,
  method: keyof typeof ProtocolResultSchemas,
  value: unknown,
): void {
  const result = ProtocolResultSchemas[method].parse(value);
  connection.send(
    ProtocolResponseSchema.parse({
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      jsonrpc: "2.0",
      id,
      result,
    }),
  );
}

async function streamEvents(
  connection: NdjsonConnection,
  events: AsyncIterable<WosmEvent>,
): Promise<void> {
  const iterator = events[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await nextEventOrClosed(connection, iterator);
      if (next.done) {
        return;
      }
      connection.send(
        ProtocolEventEnvelopeSchema.parse({
          schemaVersion: PROTOCOL_SCHEMA_VERSION,
          event: next.value,
        }),
      );
    }
  } finally {
    await iterator.return?.();
  }
}

async function nextEventOrClosed(
  connection: NdjsonConnection,
  iterator: AsyncIterator<WosmEvent>,
): Promise<IteratorResult<WosmEvent>> {
  return Effect.runPromise(
    Effect.raceFirst(
      Effect.tryPromise({
        try: () => iterator.next(),
        catch: protocolSafeErrorFromUnknown,
      }),
      Effect.as(
        Effect.tryPromise({
          try: () => connection.closed,
          catch: protocolSafeErrorFromUnknown,
        }),
        { done: true as const, value: undefined },
      ),
    ),
  );
}

function errorResponse(id: string, message: string, error?: unknown) {
  const parsedSafeError = SafeErrorSchema.safeParse(error);
  const safeError = parsedSafeError.success ? parsedSafeError.data : protocolSafeError({ message });
  return ProtocolResponseSchema.parse({
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    jsonrpc: "2.0",
    id,
    error: safeError,
  });
}

function protocolSafeErrorFromUnknown(error: unknown) {
  const parsedSafeError = SafeErrorSchema.safeParse(error);
  return parsedSafeError.success
    ? parsedSafeError.data
    : protocolSafeError({ message: "Observer protocol method failed." });
}

function requestId(message: unknown): string {
  if (message && typeof message === "object" && "id" in message && typeof message.id === "string") {
    return message.id;
  }
  return "unknown";
}
