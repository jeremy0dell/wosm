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
      ...(request.sessionId === undefined ? {} : { WOSM_SESSION_ID: request.sessionId }),
    },
    mode: request.mode ?? "interactive",
    displayTitle: `${request.project.label} OpenCode`,
    providerData: {
      skeleton: true,
      ...(request.initialPrompt === undefined ? {} : { initialPromptProvided: true }),
      ...(request.profile === undefined ? {} : { profile: request.profile }),
      ...(request.approvalPolicy === undefined ? {} : { approvalPolicy: request.approvalPolicy }),
      ...(request.sandboxMode === undefined ? {} : { sandboxMode: request.sandboxMode }),
    },
  };
}
