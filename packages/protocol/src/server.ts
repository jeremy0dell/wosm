import type {
  CommandId,
  CommandReceipt,
  CommandRecord,
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
import {
  CommandDispatchParamsSchema,
  CommandGetParamsSchema,
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
};

export type ProtocolServerOptions = {
  socketPath: string;
  api: ObserverApi;
};

export async function startProtocolServer(
  options: ProtocolServerOptions,
): Promise<UnixSocketServer> {
  return listenUnixSocket({
    socketPath: options.socketPath,
    onConnection: (connection) => handleConnection(connection, options.api),
  });
}

async function handleConnection(connection: NdjsonConnection, api: ObserverApi): Promise<void> {
  try {
    for await (const message of connection.messages()) {
      const request = ProtocolRequestSchema.safeParse(message);
      if (!request.success) {
        connection.send(errorResponse(requestId(message), "Invalid protocol request."));
        continue;
      }
      await routeRequest(connection, api, request.data);
    }
  } catch {
    connection.close();
  }
}

async function routeRequest(
  connection: NdjsonConnection,
  api: ObserverApi,
  request: ProtocolRequest,
): Promise<void> {
  try {
    switch (request.method) {
      case "observer.health": {
        const result = await api.health();
        sendResult(connection, request.id, "observer.health", result);
        return;
      }
      case "observer.stop": {
        const result = await api.stop();
        sendResult(connection, request.id, "observer.stop", result);
        return;
      }
      case "snapshot.get": {
        const params = SnapshotGetParamsSchema.parse(request.params);
        const result = await api.getSnapshot(
          params?.includeDebug === undefined ? undefined : { includeDebug: params.includeDebug },
        );
        sendResult(connection, request.id, "snapshot.get", result);
        return;
      }
      case "command.dispatch": {
        const params = CommandDispatchParamsSchema.parse(request.params);
        const result = await api.dispatch(params.command);
        sendResult(connection, request.id, "command.dispatch", result);
        return;
      }
      case "command.get": {
        const params = CommandGetParamsSchema.parse(request.params);
        const result = (await api.getCommand(params.commandId)) ?? null;
        sendResult(connection, request.id, "command.get", result);
        return;
      }
      case "observer.reconcile": {
        const params = ReconcileParamsSchema.parse(request.params);
        const result = await api.reconcile(params?.reason);
        sendResult(connection, request.id, "observer.reconcile", result);
        return;
      }
      case "observer.ingestHookEvent": {
        const params = HookIngestParamsSchema.parse(request.params);
        const result = await api.ingestHookEvent(params.event);
        sendResult(connection, request.id, "observer.ingestHookEvent", result);
        return;
      }
      case "events.subscribe": {
        const params = EventsSubscribeParamsSchema.parse(request.params);
        sendResult(connection, request.id, "events.subscribe", { subscribed: true });
        await streamEvents(connection, api.subscribe(params));
        return;
      }
    }
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
      const next = await Promise.race([
        iterator.next(),
        connection.closed.then(() => ({ done: true as const, value: undefined })),
      ]);
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

function requestId(message: unknown): string {
  if (message && typeof message === "object" && "id" in message && typeof message.id === "string") {
    return message.id;
  }
  return "unknown";
}
