import type {
  BuildHarnessLaunchRequest,
  HarnessRunObservation,
  RawHarnessEvent,
} from "@wosm/contracts";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { PiHarnessProvider } from "../../src/provider";

const now = "2026-05-27T12:00:00.000Z";

describe("PiHarnessProvider", () => {
  it("declares interactive Pi v1 capabilities", () => {
    const provider = new PiHarnessProvider();

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

  it("checks pi --version for provider health without requiring auth", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new PiHarnessProvider({
      command: "pi-test",
      now: () => new Date(now),
      runner: async (input) => {
        calls.push(input);
        return result(input, "pi 1.2.3\n");
      },
    });

    await expect(provider.health()).resolves.toMatchObject({
      providerId: "pi",
      providerType: "harness",
      status: "healthy",
      lastCheckedAt: now,
      diagnostics: {
        command: "pi --version succeeded",
      },
    });
    expect(calls.map((call) => call.args)).toEqual([["--version"]]);
  });

  it("falls back to WOSM_PI_BIN when no command is configured", async () => {
    const previous = process.env.WOSM_PI_BIN;
    process.env.WOSM_PI_BIN = "pi-from-env";
    try {
      const provider = new PiHarnessProvider({ now: () => new Date(now) });

      await expect(provider.buildLaunch(request())).resolves.toMatchObject({
        command: "pi-from-env",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.WOSM_PI_BIN;
      } else {
        process.env.WOSM_PI_BIN = previous;
      }
    }
  });

  it("maps health failures to typed harness provider health", async () => {
    const provider = new PiHarnessProvider({
      command: "missing-pi",
      now: () => new Date(now),
      runner: async () => {
        throw Object.assign(new Error("not found"), {
          code: "ENOENT",
          stderr: "missing-pi: command not found",
        });
      },
    });

    await expect(provider.health()).resolves.toMatchObject({
      providerId: "pi",
      providerType: "harness",
      status: "unavailable",
      lastError: {
        tag: "HarnessProviderError",
        code: "HARNESS_PI_UNAVAILABLE",
        provider: "pi",
      },
    });
  });

  it("applies provider launch defaults and discovers terminal-bound runs", async () => {
    const provider = new PiHarnessProvider({
      command: "pi-test",
      extensionPath: "/tmp/wosm/piExtension.js",
      configPath: "/tmp/wosm/config.toml",
      now: () => new Date(now),
    });

    await expect(provider.buildLaunch(request())).resolves.toMatchObject({
      command: "pi-test",
      args: ["--extension", "/tmp/wosm/piExtension.js"],
      env: {
        WOSM_CONFIG_PATH: "/tmp/wosm/config.toml",
      },
    });

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
            providerData: {
              role: "main-agent",
              harness: "pi",
              currentCommand: "pi",
            },
          },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "pi:tmux:wosm:@1:%2",
        provider: "pi",
        worktreeId: "wt_web_task",
        state: "unknown",
        confidence: "low",
      }),
    ]);
  });

  it("classifies and ingests Pi observations through provider-local parsing", async () => {
    const provider = new PiHarnessProvider({ now: () => new Date(now) });

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
        provider: "pi",
        worktreeId: "wt_web_task",
        rawEventType: "agent_start",
        status: expect.objectContaining({
          value: "working",
          source: "harness_event",
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
    throw new Error("Pi provider fixture is missing a terminal target.");
  }
  return {
    project: {
      id: "web",
      label: "web",
      root: "/tmp/wosm/web",
      defaults: {
        harness: "pi",
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
    id: "pi:tmux:wosm:@1:%2",
    provider: "pi",
    projectId: "web",
    worktreeId: "wt_web_task",
    sessionId: "ses_web_task",
    state: "unknown",
    confidence: "low",
    reason: "terminal target is bound to Pi; no reliable lifecycle signal yet.",
    observedAt: now,
  };
}

function event(): RawHarnessEvent {
  return {
    provider: "pi",
    observedAt: now,
    event: {
      event_type: "agent_start",
      cwd: "/tmp/wosm/web/task",
      pi_session_id: "pi_session_123",
      wosm_project_id: "web",
      wosm_worktree_id: "wt_web_task",
      wosm_session_id: "ses_web_task",
      wosm_terminal_target_id: "tmux:wosm:@1:%2",
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
        providerData: {
          role: "main-agent",
          harness: "pi",
        },
      },
    ],
  };
}
