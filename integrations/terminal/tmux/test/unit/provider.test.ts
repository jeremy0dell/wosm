import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { TmuxProvider } from "../../src/provider";

const now = "2026-05-21T12:00:00.000Z";
const project = {
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
    base: "main",
  },
};
const worktree = {
  id: "wt_web_feature",
  provider: "worktrunk",
  projectId: "web",
  branch: "feature/login",
  path: "/tmp/wosm/web/feature",
  state: "exists" as const,
  source: "worktrunk" as const,
  observedAt: now,
};

describe("TmuxProvider", () => {
  it("declares the reference tmux capabilities", () => {
    const provider = new TmuxProvider();

    expect(provider.id).toBe("tmux");
    expect(provider.capabilities()).toEqual({
      canOpenWorkspace: true,
      canFocusTarget: true,
      canCloseTarget: true,
      canCaptureOutput: true,
      canSendInput: true,
      canPersistIdentityBinding: true,
      canDisplayPopup: true,
    });
  });

  it("opens or reuses a workbench window and binds the primary pane identity", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new TmuxProvider({
      clock: { now: () => new Date(now) },
      runner: async (input) => {
        calls.push(input);
        if (input.args?.[0] === "has-session") {
          throw Object.assign(new Error("missing"), { code: 1, stderr: "can't find session" });
        }
        if (input.args?.[0] === "display-message") {
          return result(input, "wosm\t@7\t%8");
        }
        return result(input, "");
      },
    });

    await expect(
      provider.openWorkspace({
        project,
        worktree,
        harness: "codex",
        layout: "agent-shell",
        sessionId: "ses_web_feature",
      }),
    ).resolves.toMatchObject({
      target: {
        provider: "tmux",
        targetId: "tmux:wosm:@7:%8",
        projectId: "web",
        worktreeId: "wt_web_feature",
        sessionId: "ses_web_feature",
        confidence: "high",
      },
      agentEndpointId: "%8",
    });

    expect(calls.map((call) => call.args)).toEqual([
      ["has-session", "-t", "wosm"],
      ["new-session", "-d", "-s", "wosm", "-n", "web-feature-login", "-c", "/tmp/wosm/web/feature"],
      ["set-option", "-w", "-t", "wosm:web-feature-login", "@wosm.session_id", "ses_web_feature"],
      ["set-option", "-w", "-t", "wosm:web-feature-login", "@wosm.project_id", "web"],
      ["set-option", "-w", "-t", "wosm:web-feature-login", "@wosm.worktree_id", "wt_web_feature"],
      [
        "set-option",
        "-w",
        "-t",
        "wosm:web-feature-login",
        "@wosm.worktree_path",
        "/tmp/wosm/web/feature",
      ],
      ["set-option", "-p", "-t", "wosm:web-feature-login.0", "@wosm.role", "main-agent"],
      ["set-option", "-p", "-t", "wosm:web-feature-login.0", "@wosm.harness", "codex"],
      [
        "display-message",
        "-p",
        "-t",
        "wosm:web-feature-login.0",
        "#{session_name}\t#{window_id}\t#{pane_id}",
      ],
    ]);
  });

  it("lists targets using an explicit tmux format", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new TmuxProvider({
      clock: { now: () => new Date(now) },
      runner: async (input) => {
        calls.push(input);
        return result(
          input,
          [
            "wosm",
            "@1",
            "%2",
            "1",
            "/tmp/wosm/web/feature",
            "12345",
            "codex",
            "web-feature",
            "ses_web_feature",
            "web",
            "wt_web_feature",
            "main-agent",
            "codex",
          ].join("\t"),
        );
      },
    });

    await expect(provider.listTargets()).resolves.toEqual([
      expect.objectContaining({
        id: "tmux:wosm:@1:%2",
        worktreeId: "wt_web_feature",
        provider: "tmux",
      }),
    ]);
    expect(calls[0]?.args).toEqual([
      "list-panes",
      "-a",
      "-F",
      expect.stringContaining("#{session_name}"),
    ]);
    expect(calls[0]?.args).toEqual([
      "list-panes",
      "-a",
      "-F",
      expect.stringContaining("#{pane_current_command}"),
    ]);
  });

  it("maps stale target focus to a typed TerminalProviderError", async () => {
    const provider = new TmuxProvider({
      runner: async () => {
        throw Object.assign(new Error("can't find pane"), { code: 1, stderr: "can't find pane" });
      },
    });

    await expect(provider.focusTarget("tmux:wosm:@missing:%missing")).rejects.toMatchObject({
      tag: "TerminalProviderError",
      code: "TERMINAL_TARGET_MISSING",
      provider: "tmux",
    });
  });

  it("focuses the originating tmux client before selecting the workbench window and pane", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new TmuxProvider({
      runner: async (input) => {
        calls.push(input);
        return result(input, "");
      },
    });

    await expect(
      provider.focusTarget("tmux:wosm:@1:%2", {
        origin: {
          provider: "tmux",
          clientId: "client_1",
        },
      }),
    ).resolves.toBeUndefined();

    expect(calls.map((call) => call.args)).toEqual([
      ["switch-client", "-c", "client_1", "-t", "wosm"],
      ["select-window", "-t", "wosm:@1"],
      ["select-pane", "-t", "%2"],
    ]);
  });

  it("launches a structured harness plan in the primary agent pane", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new TmuxProvider({
      clock: { now: () => new Date(now) },
      runner: async (input) => {
        calls.push(input);
        return result(input, "");
      },
    });

    await expect(
      provider.launchProcess?.({
        project,
        worktree,
        terminalTarget: {
          provider: "tmux",
          targetId: "tmux:wosm:@web-feature-login:%web-feature-login-main",
          projectId: "web",
          worktreeId: "wt_web_feature",
          sessionId: "ses_web_feature",
          confidence: "high",
          reason: "Fixture binding.",
          providerData: {
            paneTarget: "wosm:web-feature-login.0",
          },
        },
        agentEndpointId: "%web-feature-login-main",
        launchPlan: {
          provider: "codex",
          command: "codex",
          args: ["--cd", "/tmp/wosm/web/feature"],
          cwd: "/tmp/wosm/web/feature",
          env: {
            WOSM_SESSION_ID: "ses_web_feature",
            WOSM_TOKEN: "value with spaces",
          },
          mode: "interactive",
        },
      }),
    ).resolves.toMatchObject({
      started: true,
      terminalTargetId: "tmux:wosm:@web-feature-login:%web-feature-login-main",
      agentEndpointId: "%web-feature-login-main",
    });

    expect(calls.map((call) => call.args)).toEqual([
      [
        "send-keys",
        "-t",
        "wosm:web-feature-login.0",
        "cd '/tmp/wosm/web/feature' && env 'WOSM_SESSION_ID=ses_web_feature' 'WOSM_TOKEN=value with spaces' codex --cd '/tmp/wosm/web/feature'",
        "C-m",
      ],
    ]);
  });

  it("aborts tmux subprocesses on timeout with a typed error", async () => {
    let aborted = false;
    const provider = new TmuxProvider({
      timeoutMs: 5,
      runner: async (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" }));
          });
        }),
    });

    await expect(provider.listTargets()).rejects.toMatchObject({
      tag: "TerminalProviderError",
      code: "TERMINAL_TMUX_TIMEOUT",
    });
    expect(aborted).toBe(true);
  });

  it("maps launch timeout to a typed terminal provider error", async () => {
    let aborted = false;
    const provider = new TmuxProvider({
      timeoutMs: 5,
      runner: async (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" }));
          });
        }),
    });

    await expect(
      provider.launchProcess?.({
        project,
        worktree,
        terminalTarget: {
          provider: "tmux",
          targetId: "tmux:wosm:@web-feature-login:%web-feature-login-main",
          projectId: "web",
          worktreeId: "wt_web_feature",
          sessionId: "ses_web_feature",
          confidence: "high",
          reason: "Fixture binding.",
        },
        agentEndpointId: "%web-feature-login-main",
        launchPlan: {
          provider: "codex",
          command: "codex",
          args: [],
          cwd: "/tmp/wosm/web/feature",
          mode: "interactive",
        },
      }),
    ).rejects.toMatchObject({
      tag: "TerminalProviderError",
      code: "TERMINAL_TMUX_TIMEOUT",
    });
    expect(aborted).toBe(true);
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
