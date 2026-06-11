import type { BuildHarnessLaunchRequest } from "@wosm/contracts";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { ClaudeHarnessProvider } from "../../src/provider";

const now = "2026-06-11T12:00:00.000Z";

describe("ClaudeHarnessProvider", () => {
  it("declares real Claude Code capabilities", () => {
    const provider = new ClaudeHarnessProvider();

    expect(provider.capabilities()).toEqual({
      canLaunch: true,
      canDiscoverRuns: true,
      canEmitEvents: true,
      canClassifyStatus: true,
      canReceivePrompt: false,
      canResume: false,
      canStop: false,
      canRunNonInteractive: true,
      canExposeApprovalState: true,
    });
  });

  it("checks the claude version for provider health", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new ClaudeHarnessProvider({
      command: "claude-test",
      now: () => new Date(now),
      runner: async (input) => {
        calls.push(input);
        return result(input, "2.1.173 (Claude Code)\n");
      },
    });

    await expect(provider.health()).resolves.toMatchObject({
      providerId: "claude",
      providerType: "harness",
      status: "healthy",
      lastCheckedAt: now,
      diagnostics: {
        version: "2.1.173 (Claude Code)",
      },
    });
    expect(calls.map((call) => call.args)).toEqual([["--version"]]);
  });

  it("maps health failures to typed harness provider health", async () => {
    const provider = new ClaudeHarnessProvider({
      command: "missing-claude",
      now: () => new Date(now),
      runner: async () => {
        throw Object.assign(new Error("not found"), {
          code: "ENOENT",
          stderr: "missing-claude: command not found",
        });
      },
    });

    await expect(provider.health()).resolves.toMatchObject({
      providerId: "claude",
      providerType: "harness",
      status: "unavailable",
      lastError: {
        tag: "HarnessProviderError",
        code: "HARNESS_CLAUDE_UNAVAILABLE",
        provider: "claude",
      },
    });
  });

  it("reports authenticated doctor checks when auth status is logged in", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new ClaudeHarnessProvider({
      command: "claude-test",
      now: () => new Date(now),
      runner: async (input) => {
        calls.push(input);
        if (input.args?.[0] === "--version") {
          return result(input, "2.1.173 (Claude Code)\n");
        }
        return result(input, '{"loggedIn": true, "authMethod": "claude.ai"}\n');
      },
    });

    const checks = await provider.doctorChecks();

    expect(checks).toEqual([
      expect.objectContaining({ name: "claude.version", status: "ok" }),
      expect.objectContaining({ name: "claude.auth", status: "ok" }),
      expect.objectContaining({ name: "claude-hooks", status: "ok" }),
    ]);
    expect(calls.map((call) => call.args)).toEqual([["--version"], ["auth", "status"]]);
  });

  it("warns in doctor checks when claude is not logged in", async () => {
    const provider = new ClaudeHarnessProvider({
      command: "claude-test",
      now: () => new Date(now),
      runner: async (input) => {
        if (input.args?.[0] === "--version") {
          return result(input, "2.1.173 (Claude Code)\n");
        }
        return result(input, '{"loggedIn": false}\n');
      },
    });

    const checks = await provider.doctorChecks();

    expect(checks[1]).toMatchObject({
      name: "claude.auth",
      status: "warn",
    });
    expect(checks[1]?.message).toContain("login");
  });

  it("applies provider launch defaults and discovers terminal-bound runs", async () => {
    const provider = new ClaudeHarnessProvider({
      command: "claude-test",
      profile: "team-default",
      now: () => new Date(now),
    });

    await expect(provider.buildLaunch(request())).resolves.toMatchObject({
      command: "claude-test",
      args: ["--agent", "team-default"],
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
            harnessBinding: {
              role: "main-agent",
              harnessProvider: "claude",
              worktreePath: "/tmp/wosm/web/task",
              currentCommand: "claude",
            },
          },
        ],
      }),
    ).resolves.toMatchObject([
      {
        id: "claude:tmux:wosm:@1:%2",
        provider: "claude",
        state: "unknown",
        confidence: "low",
      },
    ]);
  });

  it("classifies discovered runs conservatively", async () => {
    const provider = new ClaudeHarnessProvider({ now: () => new Date(now) });

    const status = await provider.classifyRun(
      {
        id: "claude:tmux:wosm:@1:%2",
        provider: "claude",
        state: "unknown",
        confidence: "low",
        reason: "terminal target is bound to Claude Code.",
        observedAt: now,
      },
      { projects: [], worktrees: [], terminalTargets: [] },
    );

    expect(status.status).toMatchObject({
      value: "unknown",
      confidence: "low",
    });
  });

  it("ingests forwarded hook events through provider-local parsing", async () => {
    const provider = new ClaudeHarnessProvider();

    const observations = await provider.ingestEvent(
      {
        provider: "claude",
        event: {
          hook_event_name: "Stop",
          session_id: "b97830b1-155a-4eb1-be06-8c497fcbb2a9",
          cwd: "/tmp/wosm/web/task",
          stop_hook_active: false,
          wosm_session_id: "ses_web_task",
          wosm_worktree_id: "wt_web_task",
        },
        observedAt: now,
      },
      { projects: [], worktrees: [], terminalTargets: [] },
    );

    expect(observations[0]).toMatchObject({
      provider: "claude",
      rawEventType: "Stop",
      sessionId: "ses_web_task",
      worktreeId: "wt_web_task",
      status: { value: "idle", confidence: "high" },
    });
  });

  it("rejects malformed events with a typed ingest error", async () => {
    const provider = new ClaudeHarnessProvider();

    await expect(
      provider.ingestEvent(
        { provider: "claude", event: { hook_event_name: "Stop" } },
        { projects: [], worktrees: [], terminalTargets: [] },
      ),
    ).rejects.toMatchObject({
      tag: "HarnessProviderError",
      code: "HARNESS_CLAUDE_EVENT_INVALID",
      provider: "claude",
    });
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
  return {
    project: {
      id: "web",
      label: "web",
      root: "/tmp/wosm/web",
      defaults: {
        harness: "claude",
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
  };
}
