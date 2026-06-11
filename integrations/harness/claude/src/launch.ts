import type {
  BuildHarnessLaunchRequest,
  HarnessLaunchPlan,
  HarnessPermissionMode,
} from "@wosm/contracts";

export type ClaudeLaunchOptions = {
  command?: string;
  defaultProfile?: string;
  defaultPermissionMode?: HarnessPermissionMode;
  defaultApprovalPolicy?: string;
  defaultSandboxMode?: string;
  hookSettingsPath?: string;
};

type ClaudeProviderDataInput = {
  mode: "interactive" | "exec";
  initialPromptProvided: boolean;
  profile?: string | undefined;
  permissionMode?: HarnessPermissionMode | undefined;
  settingsInjected?: boolean | undefined;
  terminalProvider?: string | undefined;
  terminalTargetId?: string | undefined;
};

const CLAUDE_YOLO_FLAG = "--dangerously-skip-permissions";

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

function claudeLaunchEnv(request: BuildHarnessLaunchRequest): Record<string, string> {
  const env: Record<string, string> = {
    WOSM_PROJECT_ID: request.project.id,
    WOSM_WORKTREE_ID: request.worktree.id,
    WOSM_WORKTREE_PATH: request.worktree.path,
    WOSM_HARNESS_PROVIDER: "claude",
  };
  if (request.sessionId !== undefined) {
    env.WOSM_SESSION_ID = request.sessionId;
  }
  if (request.terminalTarget !== undefined) {
    env.WOSM_TERMINAL_PROVIDER = request.terminalTarget.provider;
    env.WOSM_TERMINAL_TARGET_ID = request.terminalTarget.id;
  }
  return env;
}

function claudeProviderData(input: ClaudeProviderDataInput): Record<string, unknown> {
  const providerData: Record<string, unknown> = {
    interactive: input.mode === "interactive",
  };
  if (input.initialPromptProvided) {
    providerData.initialPromptProvided = true;
  }
  if (input.profile !== undefined) {
    providerData.profile = input.profile;
  }
  if (input.permissionMode !== undefined) {
    providerData.permissionMode = input.permissionMode;
  }
  if (input.settingsInjected === true) {
    providerData.settingsInjected = true;
  }
  if (input.terminalProvider !== undefined) {
    providerData.terminalProvider = input.terminalProvider;
  }
  if (input.terminalTargetId !== undefined) {
    providerData.terminalTargetId = input.terminalTargetId;
  }
  return providerData;
}

export function buildClaudeLaunchPlan(
  request: BuildHarnessLaunchRequest,
  options: ClaudeLaunchOptions = {},
): HarnessLaunchPlan {
  const mode = request.mode ?? "interactive";
  const profile = request.profile ?? options.defaultProfile;
  const permissionMode = request.permissionMode ?? options.defaultPermissionMode;
  const approvalPolicy = request.approvalPolicy ?? options.defaultApprovalPolicy;
  const sandboxMode = request.sandboxMode ?? options.defaultSandboxMode;
  const yolo = isYoloPermissionMode({ permissionMode, approvalPolicy, sandboxMode });
  const providerPermissionMode = yolo ? "yolo" : permissionMode;

  // Claude Code has no --cd flag; the worktree is selected via the launch plan cwd.
  const args: string[] =
    mode === "exec" ? ["-p", "--output-format", "stream-json", "--verbose"] : [];
  if (profile !== undefined) {
    args.push("--agent", profile);
  }
  if (yolo) {
    args.push(CLAUDE_YOLO_FLAG);
  }
  if (options.hookSettingsPath !== undefined) {
    args.push("--settings", options.hookSettingsPath);
  }
  if (request.initialPrompt !== undefined) {
    args.push(request.initialPrompt);
  }

  const providerDataInput: ClaudeProviderDataInput = {
    mode,
    initialPromptProvided: request.initialPrompt !== undefined,
  };
  if (profile !== undefined) {
    providerDataInput.profile = profile;
  }
  if (providerPermissionMode !== undefined) {
    providerDataInput.permissionMode = providerPermissionMode;
  }
  if (options.hookSettingsPath !== undefined) {
    providerDataInput.settingsInjected = true;
  }
  if (request.terminalTarget !== undefined) {
    providerDataInput.terminalProvider = request.terminalTarget.provider;
    providerDataInput.terminalTargetId = request.terminalTarget.id;
  }

  return {
    provider: "claude",
    command: options.command ?? "claude",
    args,
    cwd: request.worktree.path,
    env: claudeLaunchEnv(request),
    mode,
    displayTitle: `${request.project.label} Claude`,
    providerData: claudeProviderData(providerDataInput),
  };
}
