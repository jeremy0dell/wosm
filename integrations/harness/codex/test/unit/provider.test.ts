import type { BuildHarnessLaunchRequest, HarnessRunObservation } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { CodexHarnessProvider } from "../../src/provider";

const now = "2026-05-20T12:00:00.000Z";

describe("CodexHarnessProvider skeleton", () => {
  it("satisfies harness provider contracts without executing Codex", async () => {
    const provider = new CodexHarnessProvider({
      command: "codex",
      now: () => new Date(now),
    });

    expect(provider.capabilities()).toMatchObject({
      canLaunch: true,
      canDiscoverRuns: true,
      canClassifyStatus: true,
      canReceivePrompt: false,
    });
    await expect(provider.health()).resolves.toMatchObject({
      providerId: "codex",
      providerType: "harness",
      status: "unknown",
    });
    await expect(provider.buildLaunch(request())).resolves.toMatchObject({
      provider: "codex",
      command: "codex",
      args: ["--cd", "/tmp/wosm/web/task"],
      cwd: "/tmp/wosm/web/task",
      mode: "interactive",
      env: {
        WOSM_SESSION_ID: "ses_web_task",
        WOSM_PROJECT_ID: "web",
        WOSM_WORKTREE_ID: "wt_web_task",
        WOSM_WORKTREE_PATH: "/tmp/wosm/web/task",
        WOSM_HARNESS_PROVIDER: "codex",
      },
      providerData: {
        skeleton: true,
        initialPromptProvided: true,
        profile: "default",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      },
    });
    await expect(
      provider.discoverRuns({ projects: [], worktrees: [], terminalTargets: [] }),
    ).resolves.toEqual([]);
    await expect(
      provider.classifyRun(run("codex"), {
        projects: [],
        worktrees: [],
        terminalTargets: [],
      }),
    ).resolves.toMatchObject({
      status: {
        value: "unknown",
        confidence: "low",
      },
    });
  });
});

function request(): BuildHarnessLaunchRequest {
  return {
    project: {
      id: "web",
      label: "web",
      root: "/tmp/wosm/web",
      defaults: {
        harness: "codex",
        terminal: "tmux",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
      },
    },
    worktree: {
      id: "wt_web_task",
      provider: "worktrunk",
      projectId: "web",
      branch: "task",
      path: "/tmp/wosm/web/task",
      state: "exists",
      source: "worktrunk",
      observedAt: now,
    },
    mode: "interactive",
    sessionId: "ses_web_task",
    initialPrompt: "Do not send this automatically.",
    profile: "default",
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
  };
}

function run(provider: string): HarnessRunObservation {
  return {
    id: "run_web_task",
    provider,
    projectId: "web",
    worktreeId: "wt_web_task",
    state: "unknown",
    confidence: "low",
    reason: "Provider skeleton has no reliable status signal.",
    observedAt: now,
  };
}
