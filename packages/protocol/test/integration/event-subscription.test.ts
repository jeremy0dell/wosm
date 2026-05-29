import type { EventFilter, WosmEvent } from "@wosm/contracts";
import {
  connectUnixSocket,
  createObserverClient,
  listenUnixSocket,
  PROTOCOL_SCHEMA_VERSION,
  startProtocolServer,
} from "@wosm/protocol";
import { describe, expect, it } from "vitest";
import { createTempSocketPath } from "../../../../tests/support/sockets";
import {
  createFakeObserverApi,
  ids,
  protocolTestNow as now,
  stream,
  waitFor,
} from "../support/fixtures.js";

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
      ...createFakeObserverApi(),
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
      ...createFakeObserverApi(),
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

  it("times out and closes the socket when subscription ack hangs", async () => {
    const { socketPath } = await createTempSocketPath();
    let closed = false;
    const server = await listenUnixSocket({
      socketPath,
      onConnection: async (connection) => {
        await connection.closed;
        closed = true;
      },
    });
    const client = createObserverClient({ socketPath, timeoutMs: 10, requestId: ids("hang") });
    const iterator = client.subscribe()[Symbol.asyncIterator]();

    try {
      await expect(iterator.next()).rejects.toMatchObject({
        tag: "TimeoutError",
        code: "PROTOCOL_SUBSCRIBE_TIMEOUT",
      });
      await waitFor(() => closed);
    } finally {
      await iterator.return?.();
      await server.close();
    }
  });
});
