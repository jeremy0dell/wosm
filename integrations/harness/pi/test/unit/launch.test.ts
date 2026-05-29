import type { BuildHarnessLaunchRequest } from "@wosm/contracts";
import { HarnessLaunchPlanSchema } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { PiHarnessProviderError } from "../../src/errors";
import { buildPiLaunchPlan } from "../../src/launch";

const now = "2026-05-27T12:00:00.000Z";

describe("buildPiLaunchPlan", () => {
  it("builds an interactive Pi launch with WOSM extension and correlation env", () => {
    const plan = buildPiLaunchPlan(request(), {
      command: "/opt/pi/bin/pi",
      extensionPath: "/opt/wosm/piExtension.js",
      configPath: "/tmp/wosm/config.toml",
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
    });

    expect(HarnessLaunchPlanSchema.parse(plan)).toEqual(plan);
    expect(plan).toMatchObject({
      provider: "pi",
      command: "/opt/pi/bin/pi",
      args: ["--extension", "/opt/wosm/piExtension.js", "Review the task."],
      cwd: "/tmp/wosm/web/task",
      mode: "interactive",
      env: {
        WOSM_PROJECT_ID: "web",
        WOSM_WORKTREE_ID: "wt_web_task",
        WOSM_WORKTREE_PATH: "/tmp/wosm/web/task",
        WOSM_HARNESS_PROVIDER: "pi",
        WOSM_SESSION_ID: "ses_web_task",
        WOSM_TERMINAL_PROVIDER: "tmux",
        WOSM_TERMINAL_TARGET_ID: "tmux:wosm:@1:%2",
        WOSM_CONFIG_PATH: "/tmp/wosm/config.toml",
        WOSM_OBSERVER_SOCKET_PATH: "/tmp/wosm/run/observer.sock",
        WOSM_OBSERVER_STATE_DIR: "/tmp/wosm/state",
        WOSM_HOOK_SPOOL_DIR: "/tmp/wosm/state/spool/hooks",
      },
      providerData: {
        interactive: true,
        extensionPath: "/opt/wosm/piExtension.js",
        initialPromptProvided: true,
        configPathProvided: true,
        observerSocketPathProvided: true,
        terminalProvider: "tmux",
        terminalTargetId: "tmux:wosm:@1:%2",
      },
    });
    expect(JSON.stringify(plan.providerData)).not.toContain("Review the task.");
    expect(JSON.stringify(plan)).not.toContain("undefined");
  });

  it("does not require persistent extension installation", () => {
    const plan = buildPiLaunchPlan(requestWithoutPrompt(), {
      extensionPath: "/tmp/wosm/piExtension.js",
    });

    expect(plan.args).toEqual(["--extension", "/tmp/wosm/piExtension.js"]);
    expect(plan.providerData).toMatchObject({
      extensionPath: "/tmp/wosm/piExtension.js",
    });
    expect(plan.providerData).not.toMatchObject({ initialPromptProvided: true });
  });

  it("defaults to the compiled standalone Pi extension artifact", () => {
    const plan = buildPiLaunchPlan(requestWithoutPrompt());

    expect(plan.args[0]).toBe("--extension");
    expect(plan.args[1]).toMatch(/\/integrations\/harness\/pi\/dist\/piExtension\.js$/);
  });

  it("rejects exec mode until a later Pi JSON/RPC phase", () => {
    expect(() =>
      buildPiLaunchPlan({
        ...request(),
        mode: "exec",
      }),
    ).toThrowError(PiHarnessProviderError);
  });
});

function requestWithoutPrompt(): BuildHarnessLaunchRequest {
  const base = request();
  const output: BuildHarnessLaunchRequest = {
    project: base.project,
    worktree: base.worktree,
    mode: "interactive",
  };
  if (base.terminalTarget !== undefined) {
    output.terminalTarget = base.terminalTarget;
  }
  if (base.sessionId !== undefined) {
    output.sessionId = base.sessionId;
  }
  return output;
}

function request(): BuildHarnessLaunchRequest {
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
    terminalTarget: {
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
    },
    mode: "interactive",
    sessionId: "ses_web_task",
    initialPrompt: "Review the task.",
  };
}
