import { createWosmClientRuntime, type WosmClientRuntime } from "@wosm/client";
import type { WosmEvent, WosmSnapshot } from "@wosm/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FakeObserverService, wrappedConnectError } from "../support/fakeObserverService.js";
import { createCommandSnapshot } from "../support/snapshots.js";

// Timing assertions use ratios and generous absolute bounds: jitter is ±20%
// and exponential doubling keeps consecutive jittered gaps from inverting, so
// only timer lateness adds noise, and lateness only widens later gaps.
describe("observer client runtime reconnect backoff", () => {
  const runtimes: WosmClientRuntime[] = [];

  afterEach(async () => {
    for (const runtime of runtimes.splice(0)) {
      await runtime.stop();
    }
  });

  function track(runtime: WosmClientRuntime): WosmClientRuntime {
    runtimes.push(runtime);
    return runtime;
  }

  it("escalates reconnect delays across consecutive failures", async () => {
    const service = new AlwaysFailingService(createCommandSnapshot("idle"));
    const runtime = track(
      createWosmClientRuntime({
        service,
        reconnect: { initialDelayMs: 10, maxDelayMs: 300 },
      }),
    );
    runtime.start();

    await waitFor(() => service.subscribeCount >= 6, 3_000);
    const gaps = subscribeGaps(service);
    const firstGap = gaps[0];
    const fifthGap = gaps[4];
    if (firstGap === undefined || fifthGap === undefined) {
      throw new Error("expected at least five reconnect gaps");
    }
    // Fixed-delay reconnects keep every gap equal; exponential growth makes
    // the fifth gap (~160ms jittered) dwarf the first (~10ms jittered).
    expect(fifthGap).toBeGreaterThan(firstGap * 2);
    expect(fifthGap).toBeGreaterThanOrEqual(100);
  });

  it("bounds reconnect delays at maxDelayMs", async () => {
    const service = new AlwaysFailingService(createCommandSnapshot("idle"));
    const runtime = track(
      createWosmClientRuntime({
        service,
        reconnect: { initialDelayMs: 5, maxDelayMs: 20 },
      }),
    );
    runtime.start();

    // Uncapped exponential growth from 5ms needs over four seconds of sleep
    // to reach ten reconnect gaps; the 20ms cap reaches them in under 200ms.
    await waitFor(() => service.subscribeCount >= 11, 2_500);
  });

  it("resets backoff after a successful resubscribe", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new ToggleFailingService(snapshot);
    const runtime = track(
      createWosmClientRuntime({
        service,
        reconnect: { initialDelayMs: 40, maxDelayMs: 5_000 },
      }),
    );
    runtime.start();

    await waitFor(() => service.subscribeCount >= 4, 3_000);
    const gaps = subscribeGaps(service);
    const escalatedGap = gaps[2];
    if (escalatedGap === undefined) {
      throw new Error("expected an escalated reconnect gap");
    }

    service.failing = false;
    await waitFor(() => service.waiterCount === 1, 3_000);
    service.emit(rowUpdateEvent());
    await waitFor(() => runtime.getState().connection.state === "connected", 3_000);

    const healthySubscribes = service.subscribeCount;
    const failedAt = Date.now();
    service.failing = true;
    service.failSubscriptions(wrappedConnectError());
    await waitFor(() => service.subscribeCount > healthySubscribes, 3_000);

    const lastSubscribeTime = service.subscribeTimes.at(-1);
    if (lastSubscribeTime === undefined) {
      throw new Error("expected a post-recovery subscribe attempt");
    }
    const postRecoveryGap = lastSubscribeTime - failedAt;
    // Without a reset the next delay would escalate past the pre-recovery gap
    // (~160ms jittered); a reset retries at the initial 40ms jittered delay.
    expect(postRecoveryGap).toBeLessThan(escalatedGap * 0.6);
    expect(postRecoveryGap).toBeLessThan(100);
  });
});

class AlwaysFailingService extends FakeObserverService {
  override async loadSnapshot(): Promise<WosmSnapshot> {
    this.loadCount += 1;
    throw wrappedConnectError();
  }

  override subscribeEvents(): AsyncIterable<WosmEvent> {
    this.recordSubscribe();
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw wrappedConnectError();
        },
        return: async () => ({ done: true, value: undefined }),
      }),
    };
  }
}

class ToggleFailingService extends FakeObserverService {
  failing = true;

  override async loadSnapshot(): Promise<WosmSnapshot> {
    if (this.failing) {
      this.loadCount += 1;
      throw wrappedConnectError();
    }
    return super.loadSnapshot();
  }

  override subscribeEvents(): AsyncIterable<WosmEvent> {
    if (!this.failing) {
      return super.subscribeEvents();
    }
    this.recordSubscribe();
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw wrappedConnectError();
        },
        return: async () => ({ done: true, value: undefined }),
      }),
    };
  }
}

function subscribeGaps(service: FakeObserverService): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < service.subscribeTimes.length; index += 1) {
    const previous = service.subscribeTimes[index - 1];
    const current = service.subscribeTimes[index];
    if (previous !== undefined && current !== undefined) {
      gaps.push(current - previous);
    }
  }
  return gaps;
}

function rowUpdateEvent(): WosmEvent {
  return {
    type: "worktree.updated",
    worktreeId: "wt_web_idle",
    patch: {
      display: {
        statusLabel: "working",
        sortPriority: 30,
        alert: false,
        reason: "Harness reported active generation.",
      },
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await delay(5);
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
