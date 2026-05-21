import type { EventFilter, WosmEvent } from "@wosm/contracts";
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

describe("protocol event subscriptions", () => {
  it("streams command and hook events to subscribers", async () => {
    const { socketPath } = await createTempSocketPath();
    const events: WosmEvent[] = [
      {
        type: "command.accepted",
        commandId: "cmd_1",
        command: { type: "observer.reconcile", payload: { reason: "subscription-test" } },
      },
      {
        type: "hook.ingested",
        at: now,
        hookId: "hook_1",
        provider: "worktrunk",
        event: "worktree.created",
      },
    ];
    let observedFilter: EventFilter | undefined;
    const api = {
      ...minimalApi(),
      subscribe: (filter?: EventFilter) => {
        observedFilter = filter;
        return stream(events);
      },
    };
    const server = await startProtocolServer({ socketPath, api });
    const client = createObserverClient({ socketPath, requestId: ids("sub") });

    const iterator = client
      .subscribe({ type: ["command.accepted", "hook.ingested"] })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "command.accepted", commandId: "cmd_1" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "hook.ingested", hookId: "hook_1" },
    });
    await iterator.return?.();

    expect(observedFilter).toEqual({ type: ["command.accepted", "hook.ingested"] });
    await server.close();
  });

  it("cleans up a blocked subscriber when the socket disconnects", async () => {
    const { socketPath } = await createTempSocketPath();
    let releaseNextStarted: () => void = () => undefined;
    const nextStarted = new Promise<void>((resolve) => {
      releaseNextStarted = resolve;
    });
    let returned = false;
    const blockedEvents: AsyncIterable<WosmEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          releaseNextStarted();
          return new Promise<IteratorResult<WosmEvent>>(() => undefined);
        },
        return: async () => {
          returned = true;
          return { done: true, value: undefined };
        },
      }),
    };
    const api = {
      ...minimalApi(),
      subscribe: () => blockedEvents,
    };
    const server = await startProtocolServer({ socketPath, api });
    const connection = await connectUnixSocket(socketPath, { timeoutMs: 500 });

    try {
      connection.send({
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        jsonrpc: "2.0",
        id: "blocked_sub",
        method: "events.subscribe",
      });
      const iterator = connection.messages()[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({
        done: false,
        value: {
          id: "blocked_sub",
          result: { subscribed: true },
        },
      });
      await nextStarted;

      connection.close();
      await waitFor(() => returned);
    } finally {
      connection.close();
      await server.close();
    }
  });
});

function minimalApi(): ObserverApi {
  return {
    health: async () => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      status: "healthy",
      pid: 1234,
      startedAt: now,
      version: "0.0.0",
    }),
    stop: async () => ({ schemaVersion: WOSM_SCHEMA_VERSION, stopped: true, at: now }),
    getSnapshot: async () => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      generatedAt: now,
      observer: { pid: 1234, startedAt: now, version: "0.0.0", healthy: true },
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
    }),
    subscribe: () => stream([]),
    dispatch: async () => ({ commandId: "cmd_1", accepted: true, status: "accepted" }),
    getCommand: async () => undefined,
    reconcile: async () => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      reason: "manual",
      reconciledAt: now,
      snapshot: await minimalApi().getSnapshot(),
    }),
    ingestHookEvent: async (event) => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      hookId: "hook_1",
      provider: event.provider,
      event: event.event,
      accepted: true,
      status: "ingested",
      receivedAt: event.receivedAt,
      reconciled: true,
    }),
  };
}

async function* stream(events: WosmEvent[]): AsyncIterable<WosmEvent> {
  for (const event of events) {
    yield event;
  }
}

function ids(prefix: string): () => string {
  let id = 0;
  return () => `${prefix}_${++id}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for predicate.");
}
