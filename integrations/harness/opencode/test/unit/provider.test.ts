import type { BuildHarnessLaunchRequest, HarnessRunObservation } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { OpenCodeHarnessProvider } from "../../src/provider";

const now = "2026-05-20T12:00:00.000Z";

describe("OpenCodeHarnessProvider skeleton", () => {
  it("satisfies harness provider contracts without executing OpenCode", async () => {
    const provider = new OpenCodeHarnessProvider({
      command: "opencode",
      now: () => new Date(now),
    });

    expect(provider.capabilities()).toMatchObject({
      canLaunch: true,
      canDiscoverRuns: true,
      canClassifyStatus: true,
      canReceivePrompt: false,
    });
    await expect(provider.health()).resolves.toMatchObject({
      providerId: "opencode",
      providerType: "harness",
      status: "unknown",
    });
    await expect(provider.buildLaunch(request())).resolves.toMatchObject({
      provider: "opencode",
      command: "opencode",
      args: [],
      cwd: "/tmp/wosm/web/task",
      mode: "interactive",
      env: {
        WOSM_SESSION_ID: "ses_web_task",
        WOSM_PROJECT_ID: "web",
        WOSM_WORKTREE_ID: "wt_web_task",
        WOSM_WORKTREE_PATH: "/tmp/wosm/web/task",
        WOSM_HARNESS_PROVIDER: "opencode",
      },
      providerData: {
        skeleton: true,
        initialPromptProvided: true,
        profile: "default",
      },
    });
    await expect(
      provider.discoverRuns({ projects: [], worktrees: [], terminalTargets: [] }),
    ).resolves.toEqual([]);
    await expect(
      provider.classifyRun(run("opencode"), {
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
        harness: "opencode",
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
