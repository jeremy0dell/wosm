import type { ObserverService } from "@wosm/client";
import type { WosmEvent, WosmSnapshot } from "@wosm/contracts";
import { afterEach, describe, expect, it } from "bun:test";
import { mockObserverSnapshot } from "./fixtures/mockObserverSnapshot.js";
import { createObserverWosmStateSource } from "./observerWosmStateSource.js";
import type { StationWosmStateSource } from "./types.js";

describe("createObserverWosmStateSource", () => {
  const sources: StationWosmStateSource[] = [];

  afterEach(async () => {
    for (const source of sources.splice(0)) {
      await source.stop();
    }
  });

  function track(source: StationWosmStateSource): StationWosmStateSource {
    sources.push(source);
    return source;
  }

  it("reaches connected with the observer snapshot through the shared runtime", async () => {
    const fake = createFakeObserverService(mockObserverSnapshot);
    const source = track(createObserverWosmStateSource({ service: fake.service }));

    expect(source.getState().connection.state).toBe("idle");
    source.start();

    await waitFor(() => source.getState().connection.state === "connected");
    expect(source.getState().snapshot).toBe(mockObserverSnapshot);
    expect(source.getState().snapshot?.counts.worktrees).toBe(
      mockObserverSnapshot.counts.worktrees,
    );
  });

  it("keeps the last good snapshot with a calm display-only status when the observer goes away", async () => {
    const fake = createFakeObserverService(mockObserverSnapshot);
    const source = track(createObserverWosmStateSource({ service: fake.service }));
    source.start();
    await waitFor(() => source.getState().connection.state === "connected");

    await waitFor(() => fake.hasParkedSubscriber());
    fake.failSubscription(wrappedConnectError());

    await waitFor(() => source.getState().connection.state === "displayOnly");
    expect(source.getState().snapshot).toBe(mockObserverSnapshot);
  });

  it("notifies subscribers when state changes", async () => {
    const fake = createFakeObserverService(mockObserverSnapshot);
    const source = track(createObserverWosmStateSource({ service: fake.service }));
    let notified = 0;
    source.subscribe(() => {
      notified += 1;
    });

    source.start();
    await waitFor(() => source.getState().connection.state === "connected");
    expect(notified).toBeGreaterThan(0);
  });

  it("requires a socket path or service", () => {
    expect(() => createObserverWosmStateSource({})).toThrow(/socketPath or service/);
  });
});

type Waiter = {
  resolve(result: IteratorResult<WosmEvent>): void;
  reject(error: Error): void;
};

function createFakeObserverService(snapshot: WosmSnapshot) {
  const waiters: Waiter[] = [];

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
    dispatch: async () => {
      throw new Error("dispatch is not exercised by the read-only source");
    },
    waitForCommandCompletion: async () => {
      throw new Error("waitForCommandCompletion is not exercised by the read-only source");
    },
    reconcile: async () => snapshot,
  };

  return {
    service,
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
