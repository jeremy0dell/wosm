import type { BuildHarnessLaunchRequest, HarnessLaunchPlan } from "@wosm/contracts";

export type OpenCodeLaunchOptions = {
  command?: string;
};

export function buildOpenCodeLaunchPlan(
  request: BuildHarnessLaunchRequest,
  options: OpenCodeLaunchOptions = {},
): HarnessLaunchPlan {
  return {
    provider: "opencode",
    command: options.command ?? "opencode",
    args: [],
    cwd: request.worktree.path,
    env: {
      WOSM_PROJECT_ID: request.project.id,
      WOSM_WORKTREE_ID: request.worktree.id,
      WOSM_WORKTREE_PATH: request.worktree.path,
      WOSM_HARNESS_PROVIDER: "opencode",
    },
    mode: request.mode ?? "interactive",
    displayTitle: `${request.project.label} OpenCode`,
    providerData: {
      skeleton: true,
    },
  };
}
