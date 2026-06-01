import type { EventHookConfig, EventHookInvocation, WosmEvent } from "@wosm/contracts";
import { EventHookInvocationSchema } from "@wosm/contracts";
import { createFakeExternalCommandRunner, type ExternalCommandInput } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { createEventHookRuntime, eventHookMatches } from "../../src/hooks/eventHooks";
import { createObserverEventBus } from "../../src/runtime/eventBus";

describe("observer event hooks", () => {
  it("matches event type and agent state filters", () => {
    const hook = notifyIdleHook();

    expect(eventHookMatches(hook, agentEvent("idle"))).toBe(true);
    expect(eventHookMatches(hook, agentEvent("working"))).toBe(false);
    expect(eventHookMatches(hook, { type: "observer.started", at: now })).toBe(false);
  });

  it("runs matching hooks with invocation JSON on stdin", async () => {
    const eventBus = createObserverEventBus();
    const calls: ExternalCommandInput[] = [];
    const runtime = createEventHookRuntime({
      hooks: [notifyIdleHook()],
      eventBus,
      commandRunner: createFakeExternalCommandRunner((input) => {
        calls.push(input);
        return {
          command: input.command,
          args: input.args ?? [],
          stdout: "",
          stderr: "",
          exitCode: 0,
        };
      }),
    });

    eventBus.publish(agentEvent("working"));
    eventBus.publish(agentEvent("idle"));
    await waitFor(() => calls.length === 1);
    await runtime.shutdown();

    expect(calls[0]).toMatchObject({
      command: "notify-bin",
      args: ["turn-completion"],
      timeoutMs: 1000,
    });
    const invocation = parseInvocation(calls[0]?.stdin);
    expect(invocation).toMatchObject({
      hookId: "notify-agent-idle",
      event: {
        type: "worktree.agentStateChanged",
        agent: {
          state: "idle",
          harness: "codex",
        },
      },
    });
  });

  it("isolates hook command failures from event publication", async () => {
    const eventBus = createObserverEventBus();
    let calls = 0;
    const runtime = createEventHookRuntime({
      hooks: [notifyIdleHook()],
      eventBus,
      commandRunner: createFakeExternalCommandRunner(() => {
        calls += 1;
        throw new Error("boom");
      }),
    });

    expect(() => eventBus.publish(agentEvent("idle"))).not.toThrow();
    await waitFor(() => calls === 1);
    await runtime.shutdown();
  });
});

const now = "2026-06-01T12:00:00.000Z";

function notifyIdleHook(): EventHookConfig {
  return {
    id: "notify-agent-idle",
    events: ["worktree.agentStateChanged"],
    command: "notify-bin",
    args: ["turn-completion"],
    timeoutMs: 1000,
    filter: {
      agentState: "idle",
      harness: "codex",
    },
  };
}

function agentEvent(state: "idle" | "working"): WosmEvent {
  return {
    type: "worktree.agentStateChanged",
    worktreeId: "wt_web_task",
    agent: {
      harness: "codex",
      state,
      confidence: "high",
      reason: state === "idle" ? "Codex turn completed." : "Codex is working.",
      updatedAt: now,
    },
  };
}

function parseInvocation(source: string | undefined): EventHookInvocation {
  if (source === undefined) {
    throw new Error("Expected invocation stdin.");
  }
  return EventHookInvocationSchema.parse(JSON.parse(source));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}
