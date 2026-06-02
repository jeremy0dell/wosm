import { runCli } from "@wosm/cli";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { describe, expect, it } from "vitest";

describe("CLI notify command", () => {
  it("sends a platform notification for idle agent state events", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = await runCli(["notify", "turn-completion"], {
      stdin: JSON.stringify(invocation("idle")),
      notifyDeps: {
        platform: "darwin",
        commandRunner: async (input) => {
          calls.push({ command: input.command, args: input.args ?? [] });
          return {
            command: input.command,
            args: input.args ?? [],
            stdout: "",
            stderr: "",
            exitCode: 0,
          };
        },
      },
    });

    expect(result).toMatchObject({
      code: 0,
      output: {
        notified: true,
        title: "Agent turn complete",
      },
    });
    expect(calls).toEqual([
      {
        command: "osascript",
        args: [
          "-e",
          'display notification "Codex turn completed." with title "Agent turn complete"',
        ],
      },
    ]);
  });

  it("skips non-idle agent state events", async () => {
    const result = await runCli(["notify", "turn-completion"], {
      stdin: JSON.stringify(invocation("working")),
      notifyDeps: { platform: "darwin" },
    });

    expect(result).toMatchObject({
      code: 0,
      output: {
        notified: false,
        skipped: true,
        reason: "agent-not-idle",
      },
    });
  });
});

function invocation(state: "idle" | "working") {
  return {
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: "notify-agent-idle",
    observedAt: "2026-06-01T12:00:00.000Z",
    event: {
      type: "worktree.agentStateChanged",
      worktreeId: "wt_web_task",
      agent: {
        harness: "codex",
        state,
        confidence: "high",
        reason: state === "idle" ? "Codex turn completed." : "Codex is working.",
        updatedAt: "2026-06-01T12:00:00.000Z",
      },
    },
  };
}
