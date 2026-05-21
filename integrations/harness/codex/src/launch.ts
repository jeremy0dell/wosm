import type { BuildHarnessLaunchRequest, HarnessLaunchPlan } from "@wosm/contracts";

export type CodexLaunchOptions = {
  command?: string;
};

export function buildCodexLaunchPlan(
  request: BuildHarnessLaunchRequest,
  options: CodexLaunchOptions = {},
): HarnessLaunchPlan {
  return {
    provider: "codex",
    command: options.command ?? "codex",
    args: ["--cd", request.worktree.path],
    cwd: request.worktree.path,
    env: {
      WOSM_PROJECT_ID: request.project.id,
      WOSM_WORKTREE_ID: request.worktree.id,
      WOSM_WORKTREE_PATH: request.worktree.path,
      WOSM_HARNESS_PROVIDER: "codex",
      ...(request.sessionId === undefined ? {} : { WOSM_SESSION_ID: request.sessionId }),
    },
    mode: request.mode ?? "interactive",
    displayTitle: `${request.project.label} Codex`,
    providerData: {
      skeleton: true,
      ...(request.initialPrompt === undefined ? {} : { initialPromptProvided: true }),
      ...(request.profile === undefined ? {} : { profile: request.profile }),
      ...(request.approvalPolicy === undefined ? {} : { approvalPolicy: request.approvalPolicy }),
      ...(request.sandboxMode === undefined ? {} : { sandboxMode: request.sandboxMode }),
    },
  };
}
