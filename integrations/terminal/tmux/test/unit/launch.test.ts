import type { TerminalLaunchProcessRequest } from "@wosm/contracts";
import { resolveLaunchPaneTarget } from "@wosm/tmux";
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
