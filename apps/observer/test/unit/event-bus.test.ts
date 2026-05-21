import type { WosmEvent } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { createObserverEventBus } from "../../src";

describe("observer event bus", () => {
  it("streams matching events and cleans up subscribers", async () => {
    const bus = createObserverEventBus();
    const iterator = bus
      .subscribe({ type: ["command.accepted", "hook.ingested"] })
      [Symbol.asyncIterator]();
    const commandEvent: WosmEvent = {
      type: "command.accepted",
      commandId: "cmd_1",
      command: { type: "observer.reconcile", payload: { reason: "event-bus-test" } },
    };
    const ignoredEvent: WosmEvent = {
      type: "observer.reconciled",
      at: "2026-05-20T12:00:00.000Z",
      changed: 0,
    };
    const hookEvent: WosmEvent = {
      type: "hook.ingested",
      at: "2026-05-20T12:00:01.000Z",
      hookId: "hook_1",
      provider: "worktrunk",
      event: "worktree.created",
    };

    const first = iterator.next();
    bus.publish(ignoredEvent);
    bus.publish(commandEvent);
    await expect(first).resolves.toEqual({ done: false, value: commandEvent });

    const second = iterator.next();
    bus.publish(hookEvent);

    await expect(second).resolves.toEqual({ done: false, value: hookEvent });
    await iterator.return?.();
  });
});
