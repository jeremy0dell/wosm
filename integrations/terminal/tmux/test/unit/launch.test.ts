import type { TerminalLaunchProcessRequest } from "@wosm/contracts";
import { buildRespawnPaneLaunchArgs, resolveLaunchPaneTarget } from "@wosm/tmux";
import { describe, expect, it } from "vitest";

describe("tmux launch providerData", () => {
  it("uses a schema-backed pane target when providerData is valid", () => {
    expect(
      resolveLaunchPaneTarget(
        request({
          paneTarget: "wosm:web-feature-login.0",
          ignoredFutureField: true,
        }),
      ),
    ).toBe("wosm:web-feature-login.0");
  });

  it("falls back to the agent endpoint when providerData is missing or malformed", () => {
    expect(resolveLaunchPaneTarget(request(undefined))).toBe("%web-feature-login-main");
    expect(resolveLaunchPaneTarget(request({ paneTarget: "" }))).toBe("%web-feature-login-main");
    expect(resolveLaunchPaneTarget(request({ paneTarget: 123 }))).toBe("%web-feature-login-main");
  });

  it("builds respawn-pane argv without a visible cd/env typed command", () => {
    const args = buildRespawnPaneLaunchArgs({
      paneTarget: "wosm:web-feature-login.0",
      cwdFallback: "/tmp/wosm/web/fallback",
      plan: {
        provider: "codex",
        command: "/Applications/Codex CLI/codex",
        args: [
          "--cd",
          "/tmp/wosm/web/feature",
          "--ask-for-approval",
          "on-request",
          "prompt with spaces",
        ],
        cwd: "/tmp/wosm/web/feature dir",
        env: {
          WOSM_SESSION_ID: "ses_web_feature",
          WOSM_TOKEN: "value with spaces",
        },
        mode: "interactive",
      },
    });

    expect(args).toEqual([
      "respawn-pane",
      "-k",
      "-t",
      "wosm:web-feature-login.0",
      "-c",
      "/tmp/wosm/web/feature dir",
      "-e",
      "WOSM_SESSION_ID=ses_web_feature",
      "-e",
      "WOSM_TOKEN=value with spaces",
      "'/Applications/Codex CLI/codex' --cd '/tmp/wosm/web/feature' --ask-for-approval on-request 'prompt with spaces'",
    ]);
    expect(args).not.toContain("send-keys");
    expect(args.at(-1)).not.toMatch(/^cd\s/);
    expect(args.at(-1)).not.toContain(" && env ");
  });

  it("uses the worktree path fallback as the respawn cwd when the plan omits cwd", () => {
    expect(
      buildRespawnPaneLaunchArgs({
        paneTarget: "%web-feature-login-main",
        cwdFallback: "/tmp/wosm/web/feature",
        plan: {
          provider: "codex",
          command: "codex",
          args: [],
          mode: "interactive",
        },
      }),
    ).toEqual([
      "respawn-pane",
      "-k",
      "-t",
      "%web-feature-login-main",
      "-c",
      "/tmp/wosm/web/feature",
      "codex",
    ]);
  });
});

function request(providerData: unknown): TerminalLaunchProcessRequest {
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
      id: "wt_web_feature",
      provider: "worktrunk",
      projectId: "web",
      branch: "feature/login",
      path: "/tmp/wosm/web/feature",
      state: "exists",
      source: "worktrunk",
      observedAt: "2026-05-21T12:00:00.000Z",
    },
    terminalTarget: {
      provider: "tmux",
      targetId: "tmux:wosm:@web-feature-login:%web-feature-login-main",
      projectId: "web",
      worktreeId: "wt_web_feature",
      sessionId: "ses_web_feature",
      confidence: "high",
      reason: "Fixture binding.",
      providerData,
    },
    agentEndpointId: "%web-feature-login-main",
    launchPlan: {
      provider: "codex",
      command: "codex",
      args: [],
      mode: "interactive",
    },
  };
}
