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
        targetId: "tmux:wosm:@web-feature-login:%web-feature-login-main",
        projectId: "web",
        worktreeId: "wt_web_feature",
        sessionId: "ses_web_feature",
        confidence: "high",
      },
      agentEndpointId: "%web-feature-login-main",
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
