import type {
  BuildHarnessLaunchRequest,
  HarnessRunObservation,
  RawHarnessEvent,
} from "@wosm/contracts";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { CursorHarnessProvider } from "../../src/provider";

const now = "2026-06-03T12:00:00.000Z";

describe("CursorHarnessProvider", () => {
  it("declares hook-only Cursor capabilities", () => {
    const provider = new CursorHarnessProvider();

    expect(provider.capabilities()).toEqual({
      canLaunch: true,
      canDiscoverRuns: true,
      canEmitEvents: true,
      canClassifyStatus: true,
      canReceivePrompt: false,
      canResume: false,
      canStop: false,
      canRunNonInteractive: false,
      canExposeApprovalState: false,
    });
  });

  it("checks agent --version for provider health", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new CursorHarnessProvider({
      command: "agent-test",
      now: () => new Date(now),
      runner: async (input) => {
        calls.push(input);
        return result(input, "2026.06.02-8c11d9f\n");
      },
    });

    await expect(provider.health()).resolves.toMatchObject({
      providerId: "cursor",
      providerType: "harness",
      status: "healthy",
      lastCheckedAt: now,
      diagnostics: {
        command: "agent --version succeeded",
        observation: "hooks",
      },
    });
    expect(calls.map((call) => call.args)).toEqual([["--version"]]);
  });

  it("launches interactive Cursor agent with WOSM correlation env", async () => {
    const provider = new CursorHarnessProvider({
      command: "agent-test",
    });

    await expect(provider.buildLaunch(request())).resolves.toMatchObject({
      provider: "cursor",
      command: "agent-test",
      args: ["--workspace", "/tmp/wosm/web/task"],
      cwd: "/tmp/wosm/web/task",
      env: {
        WOSM_HARNESS_PROVIDER: "cursor",
        WOSM_PROJECT_ID: "web",
        WOSM_WORKTREE_ID: "wt_web_task",
        WOSM_WORKTREE_PATH: "/tmp/wosm/web/task",
        WOSM_SESSION_ID: "ses_web_task",
        WOSM_TERMINAL_PROVIDER: "tmux",
        WOSM_TERMINAL_TARGET_ID: "tmux:wosm:@1:%2",
      },
      providerData: {
        interactive: true,
        observation: "hooks",
        terminalTargetId: "tmux:wosm:@1:%2",
      },
    });
  });

  it("discovers terminal-bound Cursor runs", async () => {
    const provider = new CursorHarnessProvider();

    await expect(
      provider.discoverRuns({
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
            harnessBinding: {
              role: "main-agent",
              harnessProvider: "cursor",
              currentCommand: "agent",
            },
          },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "cursor:tmux:wosm:@1:%2",
        provider: "cursor",
        worktreeId: "wt_web_task",
        state: "unknown",
        confidence: "low",
      }),
    ]);
  });

  it("classifies and ingests Cursor observations through provider-local parsing", async () => {
    const provider = new CursorHarnessProvider({ now: () => new Date(now) });

    await expect(
      provider.classifyRun(run(), {
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

    await expect(provider.ingestEvent?.(event(), eventContext())).resolves.toEqual([
      expect.objectContaining({
        provider: "cursor",
        worktreeId: "wt_web_task",
        rawEventType: "sessionStart",
        status: expect.objectContaining({
          value: "starting",
        }),
      }),
    ]);
  });
});

function result(input: ExternalCommandInput, stdout: string): ExternalCommandResult {
  return {
    command: input.command,
    args: input.args ?? [],
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

function request(): BuildHarnessLaunchRequest {
  const target = eventContext().terminalTargets[0];
  if (target === undefined) {
    throw new Error("Cursor provider fixture is missing a terminal target.");
  }
  return {
    project: {
      id: "web",
      label: "web",
      root: "/tmp/wosm/web",
      defaults: {
        harness: "cursor",
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
    terminalTarget: target,
    mode: "interactive",
    sessionId: "ses_web_task",
  };
}

function run(): HarnessRunObservation {
  return {
    id: "cursor:tmux:wosm:@1:%2",
    provider: "cursor",
    projectId: "web",
    worktreeId: "wt_web_task",
    sessionId: "ses_web_task",
    state: "unknown",
    confidence: "low",
    reason: "terminal target is bound to Cursor; no reliable lifecycle signal yet.",
    observedAt: now,
  };
}

function event(): RawHarnessEvent {
  return {
    provider: "cursor",
    observedAt: now,
    event: {
      hook_event_name: "sessionStart",
      session_id: "cursor_session_123",
      workspace_roots: ["/tmp/wosm/web/task"],
    },
  };
}

function eventContext() {
  return {
    projects: [],
    worktrees: [
      {
        id: "wt_web_task",
        provider: "worktrunk",
        projectId: "web",
        branch: "task",
        path: "/tmp/wosm/web/task",
        state: "exists" as const,
        source: "worktrunk" as const,
        observedAt: now,
      },
    ],
    terminalTargets: [
      {
        id: "tmux:wosm:@1:%2",
        provider: "tmux",
        projectId: "web",
        worktreeId: "wt_web_task",
        sessionId: "ses_web_task",
        state: "open" as const,
        cwd: "/tmp/wosm/web/task",
        confidence: "high" as const,
        reason: "tmux pane has wosm identity binding.",
        observedAt: now,
        harnessBinding: {
          role: "main-agent",
          harnessProvider: "cursor",
        },
      },
    ],
  };
}
