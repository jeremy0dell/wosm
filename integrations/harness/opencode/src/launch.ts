import type {
  BuildHarnessLaunchRequest,
  HarnessLaunchPlan,
  HarnessPermissionMode,
} from "@wosm/contracts";

export type OpenCodeLaunchOptions = {
  command?: string;
  defaultProfile?: string;
  defaultPermissionMode?: HarnessPermissionMode;
  defaultApprovalPolicy?: string;
  defaultSandboxMode?: string;
  configPath?: string;
  observerSocketPath?: string;
  stateDir?: string;
  hookSpoolDir?: string;
};

export function buildOpenCodeLaunchPlan(
  request: BuildHarnessLaunchRequest,
  options: OpenCodeLaunchOptions = {},
): HarnessLaunchPlan {
  const mode = request.mode ?? "interactive";
  const profile = request.profile ?? options.defaultProfile;
  const permissionMode = request.permissionMode ?? options.defaultPermissionMode;
  const approvalPolicy = request.approvalPolicy ?? options.defaultApprovalPolicy;
  const sandboxMode = request.sandboxMode ?? options.defaultSandboxMode;
  const yolo = isYoloPermissionMode({ permissionMode, approvalPolicy, sandboxMode });
  const providerPermissionMode = yolo ? "yolo" : permissionMode;
  const args = mode === "exec" ? execArgs(request) : interactiveArgs(request);
  appendOpenCodeOptions(args, {
    mode,
    profile,
    yolo,
    initialPrompt: request.initialPrompt,
  });

  const providerDataInput: OpenCodeProviderDataInput = {
    mode,
    initialPromptProvided: request.initialPrompt !== undefined,
  };
  if (profile !== undefined) {
    providerDataInput.profile = profile;
  }
  if (providerPermissionMode !== undefined) {
    providerDataInput.permissionMode = providerPermissionMode;
  }
  if (!yolo && approvalPolicy !== undefined) {
    providerDataInput.approvalPolicy = approvalPolicy;
  }
  if (!yolo && sandboxMode !== undefined) {
    providerDataInput.sandboxMode = sandboxMode;
  }
  if (options.configPath !== undefined) {
    providerDataInput.configPathProvided = true;
  }
  if (options.observerSocketPath !== undefined) {
    providerDataInput.observerSocketPathProvided = true;
  }
  if (request.terminalTarget !== undefined) {
    providerDataInput.terminalProvider = request.terminalTarget.provider;
    providerDataInput.terminalTargetId = request.terminalTarget.id;
  }

  return {
    provider: "opencode",
    command: options.command ?? "opencode",
    args,
    cwd: request.worktree.path,
    env: openCodeLaunchEnv(request, options),
    mode,
    displayTitle: `${request.project.label} OpenCode`,
    providerData: openCodeProviderData(providerDataInput),
  };
}

function interactiveArgs(_request: BuildHarnessLaunchRequest): string[] {
  return [];
}

function execArgs(_request: BuildHarnessLaunchRequest): string[] {
  return ["run", "--format", "json"];
}

function appendOpenCodeOptions(
  args: string[],
  options: {
    mode: "interactive" | "exec";
    profile?: string | undefined;
    yolo: boolean;
    initialPrompt?: string | undefined;
  },
): void {
  if (options.profile !== undefined) {
    args.push("--agent", options.profile);
  }
  if (options.mode === "exec" && options.yolo) {
    args.push("--dangerously-skip-permissions");
  }
  if (options.initialPrompt !== undefined) {
    if (options.mode === "interactive") {
      args.push("--prompt", options.initialPrompt);
    } else {
      args.push(options.initialPrompt);
    }
  }
}

function openCodeLaunchEnv(
  request: BuildHarnessLaunchRequest,
  options: OpenCodeLaunchOptions,
): Record<string, string> {
  const env: Record<string, string> = {
    WOSM_PROJECT_ID: request.project.id,
    WOSM_WORKTREE_ID: request.worktree.id,
    WOSM_WORKTREE_PATH: request.worktree.path,
    WOSM_HARNESS_PROVIDER: "opencode",
  };
  if (request.sessionId !== undefined) {
    env.WOSM_SESSION_ID = request.sessionId;
  }
  if (request.terminalTarget !== undefined) {
    env.WOSM_TERMINAL_PROVIDER = request.terminalTarget.provider;
    env.WOSM_TERMINAL_TARGET_ID = request.terminalTarget.id;
  }
  if (options.configPath !== undefined) {
    env.WOSM_CONFIG_PATH = options.configPath;
  }
  if (options.observerSocketPath !== undefined) {
    env.WOSM_OBSERVER_SOCKET_PATH = options.observerSocketPath;
  }
  if (options.stateDir !== undefined) {
    env.WOSM_OBSERVER_STATE_DIR = options.stateDir;
  }
  if (options.hookSpoolDir !== undefined) {
    env.WOSM_HOOK_SPOOL_DIR = options.hookSpoolDir;
  }
  return env;
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

type OpenCodeProviderDataInput = {
  mode: "interactive" | "exec";
  profile?: string | undefined;
  permissionMode?: HarnessPermissionMode | undefined;
  approvalPolicy?: string | undefined;
  sandboxMode?: string | undefined;
  initialPromptProvided: boolean;
  configPathProvided?: boolean | undefined;
  observerSocketPathProvided?: boolean | undefined;
  terminalProvider?: string | undefined;
  terminalTargetId?: string | undefined;
};

function openCodeProviderData(input: OpenCodeProviderDataInput): Record<string, unknown> {
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
  if (input.approvalPolicy !== undefined) {
    providerData.approvalPolicy = input.approvalPolicy;
  }
  if (input.sandboxMode !== undefined) {
    providerData.sandboxMode = input.sandboxMode;
  }
  if (input.configPathProvided === true) {
    providerData.configPathProvided = true;
  }
  if (input.observerSocketPathProvided === true) {
    providerData.observerSocketPathProvided = true;
  }
  if (input.terminalProvider !== undefined) {
    providerData.terminalProvider = input.terminalProvider;
  }
  if (input.terminalTargetId !== undefined) {
    providerData.terminalTargetId = input.terminalTargetId;
  }
  return providerData;
}
