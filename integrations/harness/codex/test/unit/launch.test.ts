import type { BuildHarnessLaunchRequest } from "@wosm/contracts";
import { HarnessLaunchPlanSchema } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { buildCodexLaunchPlan } from "../../src/launch";

const now = "2026-05-21T12:00:00.000Z";

describe("buildCodexLaunchPlan", () => {
  it("builds a shell-safe interactive argv/env plan with config defaults", () => {
    const plan = buildCodexLaunchPlan(request(), {
      command: "/opt/codex/bin/codex",
      defaultProfile: "team-default",
      defaultApprovalPolicy: "on-request",
      defaultSandboxMode: "workspace-write",
      noAltScreen: true,
    });

    expect(HarnessLaunchPlanSchema.parse(plan)).toEqual(plan);
    expect(plan).toMatchObject({
      provider: "codex",
      command: "/opt/codex/bin/codex",
      args: [
        "--cd",
        "/tmp/wosm/web/task",
        "--profile",
        "team-default",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--no-alt-screen",
        "Review the task.",
      ],
      cwd: "/tmp/wosm/web/task",
      mode: "interactive",
      env: {
        WOSM_PROJECT_ID: "web",
        WOSM_WORKTREE_ID: "wt_web_task",
        WOSM_WORKTREE_PATH: "/tmp/wosm/web/task",
        WOSM_HARNESS_PROVIDER: "codex",
        WOSM_SESSION_ID: "ses_web_task",
        WOSM_TERMINAL_PROVIDER: "tmux",
        WOSM_TERMINAL_TARGET_ID: "tmux:wosm:@1:%2",
      },
      providerData: {
        interactive: true,
        initialPromptProvided: true,
        profile: "team-default",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
        noAltScreen: true,
      },
    });
    expect(plan.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(plan.args).not.toContain("--yolo");
    expect(JSON.stringify(plan)).not.toContain("undefined");
    expect(JSON.stringify(plan.providerData)).not.toContain("Review the task.");
  });

  it("lets request options override provider defaults without setting absent option fields", () => {
    const base = request();
    if (base.terminalTarget === undefined) {
      throw new Error("Codex launch fixture is missing a terminal target.");
    }
    const requestWithoutPrompt: BuildHarnessLaunchRequest = {
      project: base.project,
      worktree: base.worktree,
      terminalTarget: base.terminalTarget,
      mode: "interactive",
      sessionId: "ses_web_task",
      profile: "request-profile",
      approvalPolicy: "never",
      sandboxMode: "read-only",
    };
    const plan = buildCodexLaunchPlan(requestWithoutPrompt, {
      defaultProfile: "team-default",
      defaultApprovalPolicy: "on-request",
      defaultSandboxMode: "workspace-write",
    });

    expect(plan.args).toEqual([
      "--cd",
      "/tmp/wosm/web/task",
      "--profile",
      "request-profile",
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
    ]);
    expect(plan.providerData).toMatchObject({
      profile: "request-profile",
      approvalPolicy: "never",
      sandboxMode: "read-only",
    });
    expect(plan.providerData).not.toMatchObject({ initialPromptProvided: true });
  });

  it("maps yolo permission mode to the native Codex bypass flag", () => {
    const plan = buildCodexLaunchPlan(request(), {
      defaultProfile: "team-default",
      defaultPermissionMode: "yolo",
      defaultApprovalPolicy: "on-request",
      defaultSandboxMode: "workspace-write",
    });

    expect(plan.args).toEqual([
      "--cd",
      "/tmp/wosm/web/task",
      "--profile",
      "team-default",
      "--dangerously-bypass-approvals-and-sandbox",
      "Review the task.",
    ]);
    expect(plan.args).not.toContain("--sandbox");
    expect(plan.args).not.toContain("--ask-for-approval");
    expect(plan.providerData).toMatchObject({
      permissionMode: "yolo",
    });
    expect(plan.providerData).not.toMatchObject({
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    });
  });

  it("maps legacy explicit yolo args to the native Codex bypass flag", () => {
    const plan = buildCodexLaunchPlan(request(), {
      defaultApprovalPolicy: "never",
      defaultSandboxMode: "danger-full-access",
    });

    expect(plan.args).toEqual([
      "--cd",
      "/tmp/wosm/web/task",
      "--dangerously-bypass-approvals-and-sandbox",
      "Review the task.",
    ]);
    expect(plan.providerData).toMatchObject({
      permissionMode: "yolo",
    });
    expect(plan.args).not.toContain("--sandbox");
    expect(plan.args).not.toContain("--ask-for-approval");
  });

  it("uses the wosm profile with the current Codex profile flag", () => {
    const plan = buildCodexLaunchPlan(request(), {
      defaultProfile: "team-default",
      defaultHookProfile: "wosm",
    });

    expect(plan.args).toEqual([
      "--cd",
      "/tmp/wosm/web/task",
      "--profile",
      "wosm",
      "Review the task.",
    ]);
    expect(plan.providerData).toMatchObject({
      profile: "wosm",
      hookProfile: "wosm",
      configuredProfile: "team-default",
    });
  });

  it("builds non-interactive codex exec plans with JSON events", () => {
    const plan = buildCodexLaunchPlan(
      {
        ...request(),
        mode: "exec",
        initialPrompt: "Summarize the worktree.",
      },
      {
        defaultProfile: "team-default",
        defaultApprovalPolicy: "never",
        defaultSandboxMode: "workspace-write",
        noAltScreen: true,
      },
    );

    expect(plan.mode).toBe("exec");
    expect(plan.args).toEqual([
      "exec",
      "--json",
      "--cd",
      "/tmp/wosm/web/task",
      "--profile",
      "team-default",
      "--sandbox",
      "workspace-write",
      "Summarize the worktree.",
    ]);
    expect(plan.args).not.toContain("--ask-for-approval");
    expect(plan.args).not.toContain("--no-alt-screen");
  });

  it("applies yolo permission mode to codex exec plans", () => {
    const plan = buildCodexLaunchPlan(
      {
        ...request(),
        mode: "exec",
        initialPrompt: "Summarize the worktree.",
      },
      {
        defaultPermissionMode: "yolo",
        defaultApprovalPolicy: "never",
        defaultSandboxMode: "danger-full-access",
      },
    );

    expect(plan.args).toEqual([
      "exec",
      "--json",
      "--cd",
      "/tmp/wosm/web/task",
      "--dangerously-bypass-approvals-and-sandbox",
      "Summarize the worktree.",
    ]);
    expect(plan.args).not.toContain("--sandbox");
    expect(plan.args).not.toContain("--ask-for-approval");
    expect(plan.providerData).toMatchObject({
      permissionMode: "yolo",
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
