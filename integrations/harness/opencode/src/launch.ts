import type {
  BuildHarnessLaunchRequest,
  HarnessLaunchPlan,
  HarnessPermissionMode,
} from "@wosm/contracts";

export type OpenCodeLaunchOptions = {
  command?: string;
  defaultPermissionMode?: HarnessPermissionMode;
  defaultApprovalPolicy?: string;
  defaultSandboxMode?: string;
};

export function buildOpenCodeLaunchPlan(
  request: BuildHarnessLaunchRequest,
  options: OpenCodeLaunchOptions = {},
): HarnessLaunchPlan {
  const permissionMode = request.permissionMode ?? options.defaultPermissionMode;
  const approvalPolicy = request.approvalPolicy ?? options.defaultApprovalPolicy;
  const sandboxMode = request.sandboxMode ?? options.defaultSandboxMode;
  const providerPermissionMode = isYoloPermissionMode({
    permissionMode,
    approvalPolicy,
    sandboxMode,
  })
    ? "yolo"
    : permissionMode;

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
      ...(providerPermissionMode === undefined ? {} : { permissionMode: providerPermissionMode }),
      ...(providerPermissionMode === "yolo" || approvalPolicy === undefined
        ? {}
        : { approvalPolicy }),
      ...(providerPermissionMode === "yolo" || sandboxMode === undefined ? {} : { sandboxMode }),
    },
  };
}

function isYoloPermissionMode(input: {
  permissionMode?: HarnessPermissionMode | undefined;
  approvalPolicy?: string | undefined;
  sandboxMode?: string | undefined;
}): boolean {
  if (input.permissionMode !== undefined) {
    return input.permissionMode === "yolo";
  }
  return input.approvalPolicy === "never" && input.sandboxMode === "danger-full-access";
}
