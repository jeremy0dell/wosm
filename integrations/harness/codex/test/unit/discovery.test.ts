import { HarnessRunObservationSchema } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { discoverCodexRuns } from "../../src/discovery";

const now = "2026-05-21T12:00:00.000Z";

describe("discoverCodexRuns", () => {
  it("turns tmux Codex identity bindings into normalized harness runs", () => {
    const runs = discoverCodexRuns({
      projects: [],
      worktrees: [],
      terminalTargets: [
        {
          id: "tmux:wosm:@1:%2",
          provider: "tmux",
          projectId: "web",
          worktreeId: "wt_web_task",
          sessionId: "ses_web_task",
          state: "open",
          cwd: "/tmp/wosm/web/task",
          pid: 1234,
          confidence: "high",
          reason: "tmux pane has wosm identity binding.",
          observedAt: now,
          providerData: {
            sessionId: "wosm",
            windowId: "@1",
            paneId: "%2",
            role: "main-agent",
            harness: "codex",
            currentCommand: "codex",
            attached: true,
            dead: false,
          },
        },
      ],
    });

    expect(runs).toHaveLength(1);
    expect(HarnessRunObservationSchema.parse(runs[0])).toEqual(runs[0]);
    expect(runs[0]).toMatchObject({
      id: "codex:tmux:wosm:@1:%2",
      provider: "codex",
      projectId: "web",
      worktreeId: "wt_web_task",
      sessionId: "ses_web_task",
      pid: 1234,
      cwd: "/tmp/wosm/web/task",
      state: "unknown",
      confidence: "low",
      reason: "tmux terminal target is bound to Codex; no reliable lifecycle signal yet.",
      providerData: {
        terminalTargetId: "tmux:wosm:@1:%2",
        terminalProvider: "tmux",
        process: {
          command: "codex",
        },
      },
    });
  });

  it("ignores non-Codex terminal bindings", () => {
    const runs = discoverCodexRuns({
      projects: [],
      worktrees: [],
      terminalTargets: [
        {
          id: "tmux:wosm:@1:%2",
          provider: "tmux",
          projectId: "web",
          worktreeId: "wt_web_task",
          state: "open",
          confidence: "high",
          reason: "tmux pane has wosm identity binding.",
          observedAt: now,
          providerData: {
            role: "main-agent",
            harness: "scripted",
          },
        },
      ],
    });

    expect(runs).toEqual([]);
  });

  it("ignores stale Codex bindings when the pane is a shell or outside the worktree", () => {
    const worktree = {
      id: "wt_web_task",
      provider: "worktrunk",
      projectId: "web",
      branch: "task",
      path: "/tmp/wosm/web/task",
      state: "exists" as const,
      source: "worktrunk" as const,
      confidence: "high" as const,
      reason: "Fixture worktree.",
      observedAt: now,
    };

    const runs = discoverCodexRuns({
      projects: [],
      worktrees: [worktree],
      terminalTargets: [
        {
          id: "tmux:wosm:@1:%2",
          provider: "tmux",
          projectId: "web",
          worktreeId: "wt_web_task",
          state: "open",
          cwd: "/tmp/wosm/web/task",
          confidence: "high",
          reason: "tmux pane has wosm identity binding.",
          observedAt: now,
          providerData: {
            role: "main-agent",
            harness: "codex",
            currentCommand: "zsh",
          },
        },
        {
          id: "tmux:wosm:@1:%3",
          provider: "tmux",
          projectId: "web",
          worktreeId: "wt_web_task",
          state: "open",
          cwd: "/tmp/wosm/web",
          confidence: "high",
          reason: "tmux pane has wosm identity binding.",
          observedAt: now,
          providerData: {
            role: "main-agent",
            harness: "codex",
            currentCommand: "node",
          },
        },
      ],
    });

    expect(runs).toEqual([]);
  });
});
