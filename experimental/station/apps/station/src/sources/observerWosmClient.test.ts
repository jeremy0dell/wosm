import type { ObserverService } from "@wosm/client";
import type { WosmEvent, WosmSnapshot } from "@wosm/contracts";
import { afterEach, describe, expect, it } from "bun:test";
import { mockObserverSnapshot } from "./fixtures/mockObserverSnapshot.js";
import { createObserverWosmClient } from "./observerWosmClient.js";
import type { StationWosmClient } from "./types.js";

describe("createObserverWosmClient", () => {
  const clients: StationWosmClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.stop();
    }
  });

  function track(client: StationWosmClient): StationWosmClient {
    clients.push(client);
    return client;
  }

  it("reaches connected with the observer snapshot through the shared runtime", async () => {
    const fake = createFakeObserverService(mockObserverSnapshot);
    const client = track(createObserverWosmClient({ service: fake.service }));

    expect(client.state.getState().connection.state).toBe("idle");
    client.start();

    await waitFor(() => client.state.getState().connection.state === "connected");
    expect(client.state.getState().snapshot).toBe(mockObserverSnapshot);
    expect(client.state.getState().snapshot?.counts.worktrees).toBe(
      mockObserverSnapshot.counts.worktrees,
    );
  });

  it("exposes the same service instance used by command paths", async () => {
    const fake = createFakeObserverService(mockObserverSnapshot);
    const client = track(createObserverWosmClient({ service: fake.service }));

    await client.service.dispatch({
      type: "observer.reconcile",
      payload: { reason: "station-test" },
    });

    expect(fake.dispatchedTypes).toEqual(["observer.reconcile"]);
    expect(client.service).toBe(fake.service);
  });

  it("keeps the last good snapshot with a calm display-only status when the observer goes away", async () => {
    const fake = createFakeObserverService(mockObserverSnapshot);
    const client = track(createObserverWosmClient({ service: fake.service }));
    client.start();
    await waitFor(() => client.state.getState().connection.state === "connected");

    await waitFor(() => fake.hasParkedSubscriber());
    fake.failSubscription(wrappedConnectError());

    await waitFor(() => client.state.getState().connection.state === "displayOnly");
    expect(client.state.getState().snapshot).toBe(mockObserverSnapshot);
  });

  it("notifies subscribers when state changes", async () => {
    const fake = createFakeObserverService(mockObserverSnapshot);
    const client = track(createObserverWosmClient({ service: fake.service }));
    let notified = 0;
    client.state.subscribe(() => {
      notified += 1;
    });

    client.start();
    await waitFor(() => client.state.getState().connection.state === "connected");
    expect(notified).toBeGreaterThan(0);
  });

  it("requires a socket path or service", () => {
    expect(() => createObserverWosmClient({})).toThrow(/socketPath or service/);
  });
});

type Waiter = {
  resolve(result: IteratorResult<WosmEvent>): void;
  reject(error: Error): void;
};

function createFakeObserverService(snapshot: WosmSnapshot) {
  const waiters: Waiter[] = [];
  const dispatchedTypes: string[] = [];

  const service: ObserverService = {
    loadSnapshot: async () => snapshot,
    subscribeEvents: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<WosmEvent>>((resolve, reject) => {
            waiters.push({ resolve, reject });
          }),
        return: async () => {
          for (const waiter of waiters.splice(0)) {
            waiter.resolve({ done: true, value: undefined });
          }
          return { done: true, value: undefined };
        },
      }),
    }),
    dispatch: async (command) => {
      dispatchedTypes.push(command.type);
      return {
        commandId: "cmd_station_test",
        accepted: true,
        status: "accepted",
      };
    },
    waitForCommandCompletion: async (commandId) => ({
      status: "succeeded",
      commandId,
    }),
    reconcile: async () => snapshot,
  };

  return {
    service,
    dispatchedTypes,
    hasParkedSubscriber: () => waiters.length > 0,
    failSubscription: (error: Error) => {
      for (const waiter of waiters.splice(0)) {
        waiter.reject(error);
      }
    },
  };
}

function wrappedConnectError(): Error {
  const error = new Error("wrapped connect failure");
  (error as Error & { cause?: unknown }).cause = {
    tag: "ProtocolError",
    code: "PROTOCOL_CONNECT_FAILED",
    message: "Could not connect to the observer socket.",
  };
  return error;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
