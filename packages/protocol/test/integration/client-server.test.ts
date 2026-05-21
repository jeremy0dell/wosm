import type {
  CommandRecord,
  HookReceipt,
  ObserverHealth,
  ObserverStopReceipt,
  ProviderHookEvent,
  ReconcileReceipt,
  WosmCommand,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import {
  connectUnixSocket,
  createObserverClient,
  type ObserverApi,
  PROTOCOL_SCHEMA_VERSION,
  startProtocolServer,
} from "@wosm/protocol";
import { describe, expect, it } from "vitest";
import { createTempSocketPath } from "../../../../tests/support/sockets";

const now = "2026-05-20T12:00:00.000Z";

describe("protocol client/server", () => {
  it("routes health, snapshot, dispatch, get, reconcile, and hook ingestion over a socket", async () => {
    const { socketPath } = await createTempSocketPath();
    const commands = new Map<string, CommandRecord>();
    const snapshot = emptySnapshot();
    const api = fakeApi({
      snapshot,
      dispatch: async (command) => {
        const record: CommandRecord = {
          id: "cmd_1",
          type: command.type,
          command,
          status: "accepted",
          createdAt: now,
        };
        commands.set(record.id, record);
        return { commandId: record.id, accepted: true, status: "accepted" };
      },
      getCommand: async (commandId) => commands.get(commandId),
    });
    const server = await startProtocolServer({ socketPath, api });
    const client = createObserverClient({ socketPath, requestId: ids("req") });

    await expect(client.health()).resolves.toMatchObject({ status: "healthy" });
    await expect(client.getSnapshot()).resolves.toMatchObject({
      schemaVersion: WOSM_SCHEMA_VERSION,
      counts: { projects: 0 },
    });

    const command: WosmCommand = {
      type: "observer.reconcile",
      payload: { reason: "protocol-test" },
    };
    await expect(client.dispatch(command)).resolves.toEqual({
      commandId: "cmd_1",
      accepted: true,
      status: "accepted",
    });
    await expect(client.getCommand("cmd_1")).resolves.toMatchObject({
      id: "cmd_1",
      type: "observer.reconcile",
    });
    await expect(client.reconcile("manual")).resolves.toMatchObject({
      schemaVersion: WOSM_SCHEMA_VERSION,
      reason: "manual",
    });

    const hookEvent: ProviderHookEvent = {
      schemaVersion: WOSM_SCHEMA_VERSION,
      provider: "worktrunk",
      kind: "worktree",
      event: "worktree.created",
      receivedAt: now,
    };
    await expect(client.ingestHookEvent(hookEvent)).resolves.toMatchObject({
      provider: "worktrunk",
      status: "ingested",
    });

    await server.close();
  });

  it("returns SafeError envelopes for invalid params without leaking validator details", async () => {
    const { socketPath } = await createTempSocketPath();
    const server = await startProtocolServer({ socketPath, api: fakeApi() });

    try {
      const response = await sendRawRequest(socketPath, {
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        jsonrpc: "2.0",
        id: "bad_params",
        method: "snapshot.get",
        params: { includeDebug: "yes" },
      });

      expect(response).toMatchObject({
        id: "bad_params",
        error: {
          tag: "ProtocolError",
          code: "PROTOCOL_ERROR",
          message: "Observer protocol method failed.",
        },
      });
      expect(JSON.stringify(response)).not.toContain("ZodError");
      expect(JSON.stringify(response)).not.toContain("includeDebug");
    } finally {
      await server.close();
    }
  });

  it("maps thrown method failures to SafeError without raw stack leakage", async () => {
    const { socketPath } = await createTempSocketPath();
    const server = await startProtocolServer({
      socketPath,
      api: fakeApi({
        health: async () => {
          throw {
            tag: "InternalObserverError",
            code: "INTERNAL_OBSERVER_FAILURE",
            message: "database exploded\n    at secret-internal-frame",
            stack: "secret stack",
          };
        },
      }),
    });
    const client = createObserverClient({ socketPath, requestId: ids("err") });

    try {
      await expect(client.health()).rejects.toMatchObject({
        tag: "ProtocolError",
        code: "PROTOCOL_ERROR",
        message: "Observer protocol method failed.",
      });
      await client.health().catch((error) => {
        expect(JSON.stringify(error)).not.toContain("secret");
        expect(JSON.stringify(error)).not.toContain("stack");
      });
    } finally {
      await server.close();
    }
  });

  it("returns undefined for a missing command record", async () => {
    const { socketPath } = await createTempSocketPath();
    const server = await startProtocolServer({ socketPath, api: fakeApi() });
    const client = createObserverClient({ socketPath, requestId: ids("missing") });

    try {
      await expect(client.getCommand("cmd_missing")).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });
});

function fakeApi(overrides: Partial<ObserverApi> & { snapshot?: WosmSnapshot } = {}): ObserverApi {
  const snapshot = overrides.snapshot ?? emptySnapshot();
  return {
    health: async (): Promise<ObserverHealth> => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      status: "healthy",
      pid: 1234,
      startedAt: now,
      version: "0.0.0",
    }),
    stop: async (): Promise<ObserverStopReceipt> => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      stopped: true,
      at: now,
    }),
    getSnapshot: async () => snapshot,
    subscribe: () => emptyEvents(),
    dispatch: async () => ({
      commandId: "cmd_1",
      accepted: true,
      status: "accepted",
    }),
    getCommand: async () => undefined,
    reconcile: async (reason = "manual"): Promise<ReconcileReceipt> => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      reason,
      reconciledAt: now,
      snapshot,
    }),
    ingestHookEvent: async (event): Promise<HookReceipt> => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      hookId: "hook_1",
      provider: event.provider,
      event: event.event,
      accepted: true,
      status: "ingested",
      receivedAt: event.receivedAt,
      reconciled: true,
    }),
    ...overrides,
  };
}

async function* emptyEvents(): AsyncIterable<WosmEvent> {}

function emptySnapshot(): WosmSnapshot {
  return {
    schemaVersion: WOSM_SCHEMA_VERSION,
    generatedAt: now,
    observer: {
      pid: 1234,
      startedAt: now,
      version: "0.0.0",
      healthy: true,
    },
    providerHealth: {},
    projects: [],
    rows: [],
    sessions: [],
    counts: {
      projects: 0,
      worktrees: 0,
      agents: 0,
      working: 0,
      idle: 0,
      attention: 0,
      unknown: 0,
    },
    alerts: [],
  };
}

function ids(prefix: string): () => string {
  let id = 0;
  return () => `${prefix}_${++id}`;
}

async function sendRawRequest(socketPath: string, request: unknown): Promise<unknown> {
  const connection = await connectUnixSocket(socketPath, { timeoutMs: 500 });
  try {
    connection.send(request);
    const iterator = connection.messages()[Symbol.asyncIterator]();
    const response = await iterator.next();
    return response.value;
  } finally {
    connection.close();
  }
}
