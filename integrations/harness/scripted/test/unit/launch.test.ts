import type { BuildHarnessLaunchRequest } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { buildScriptedAgentLaunchPlan } from "../../src/launch";

const request: BuildHarnessLaunchRequest = {
  project: {
    id: "web",
    label: "web",
    root: "/tmp/wosm/web",
    defaults: {
      harness: "scripted",
      terminal: "fake-terminal",
      layout: "agent-shell",
    },
    worktrunk: {
      enabled: true,
    },
  },
  worktree: {
    id: "wt_web_task",
    provider: "fake-worktree",
    projectId: "web",
    branch: "task",
    path: "/tmp/wosm/web/task",
    state: "exists",
    source: "worktrunk",
    observedAt: "2026-05-20T12:00:00.000Z",
  },
  mode: "interactive",
};

describe("scripted harness launch plan", () => {
  it("builds a deterministic launch plan without starting a process", () => {
    const plan = buildScriptedAgentLaunchPlan(request, {
      nodeCommand: "/usr/local/bin/node",
      runnerPath: "/tmp/wosm/scripted-agent.mjs",
      stateDir: "/tmp/wosm/state/scripted",
      scenarioPath: "/tmp/wosm/scenarios/complete-file-task.json",
      runId: "run_web_task",
      sessionId: "ses_web_task",
    });

    expect(plan).toMatchObject({
      provider: "scripted",
      command: "/usr/local/bin/node",
      cwd: "/tmp/wosm/web/task",
      mode: "interactive",
      env: {
        WOSM_PROJECT_ID: "web",
        WOSM_WORKTREE_ID: "wt_web_task",
        WOSM_WORKTREE_PATH: "/tmp/wosm/web/task",
        WOSM_HARNESS_PROVIDER: "scripted",
        WOSM_SESSION_ID: "ses_web_task",
        WOSM_SCRIPTED_RUN_ID: "run_web_task",
        WOSM_SCRIPTED_STATE_DIR: "/tmp/wosm/state/scripted",
      },
    });
    expect(plan.args).toEqual([
      "/tmp/wosm/scripted-agent.mjs",
      "--run-id",
      "run_web_task",
      "--state-dir",
      "/tmp/wosm/state/scripted",
      "--scenario",
      "/tmp/wosm/scenarios/complete-file-task.json",
    ]);
  });
});
