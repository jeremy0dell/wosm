import type { BuildHarnessLaunchRequest, HarnessLaunchPlan } from "@wosm/contracts";

export type CodexLaunchOptions = {
  command?: string;
  defaultProfile?: string;
  defaultProfileV2?: string;
  defaultApprovalPolicy?: string;
  defaultSandboxMode?: string;
  noAltScreen?: boolean;
};

export function buildCodexLaunchPlan(
  request: BuildHarnessLaunchRequest,
  options: CodexLaunchOptions = {},
): HarnessLaunchPlan {
  const mode = request.mode ?? "interactive";
  const profile = request.profile ?? options.defaultProfile;
  const profileV2 = options.defaultProfileV2;
  const approvalPolicy = request.approvalPolicy ?? options.defaultApprovalPolicy;
  const sandboxMode = request.sandboxMode ?? options.defaultSandboxMode;
  const args = mode === "exec" ? execArgs(request) : interactiveArgs(request);
  appendCodexOptions(args, {
    profile,
    profileV2,
    approvalPolicy: mode === "exec" ? undefined : approvalPolicy,
    sandboxMode,
    noAltScreen: mode === "interactive" ? options.noAltScreen : undefined,
  });
  if (request.initialPrompt !== undefined) {
    args.push(request.initialPrompt);
  }

  const env = codexLaunchEnv(request);
  const providerData = codexProviderData({
    mode,
    profile,
    profileV2,
    approvalPolicy,
    sandboxMode,
    noAltScreen: mode === "interactive" ? options.noAltScreen : undefined,
    initialPromptProvided: request.initialPrompt !== undefined,
    terminalProvider: request.terminalTarget?.provider,
    terminalTargetId: request.terminalTarget?.id,
  });

  return {
    provider: "codex",
    command: options.command ?? "codex",
    args,
    cwd: request.worktree.path,
    env,
    mode,
    displayTitle: `${request.project.label} Codex`,
    providerData,
  };
}

function interactiveArgs(request: BuildHarnessLaunchRequest): string[] {
  return ["--cd", request.worktree.path];
}

function execArgs(request: BuildHarnessLaunchRequest): string[] {
  return ["exec", "--json", "--cd", request.worktree.path];
}

function appendCodexOptions(
  args: string[],
  options: {
    profile?: string | undefined;
    profileV2?: string | undefined;
    approvalPolicy?: string | undefined;
    sandboxMode?: string | undefined;
    noAltScreen?: boolean | undefined;
  },
): void {
  if (options.profile !== undefined) {
    args.push("--profile", options.profile);
  }
  if (options.profileV2 !== undefined) {
    args.push("--profile-v2", options.profileV2);
  }
  if (options.sandboxMode !== undefined) {
    args.push("--sandbox", options.sandboxMode);
  }
  if (options.approvalPolicy !== undefined) {
    args.push("--ask-for-approval", options.approvalPolicy);
  }
  if (options.noAltScreen === true) {
    args.push("--no-alt-screen");
  }
}

function codexLaunchEnv(request: BuildHarnessLaunchRequest): Record<string, string> {
  const env: Record<string, string> = {
    WOSM_PROJECT_ID: request.project.id,
    WOSM_WORKTREE_ID: request.worktree.id,
    WOSM_WORKTREE_PATH: request.worktree.path,
    WOSM_HARNESS_PROVIDER: "codex",
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

function codexProviderData(input: {
  mode: "interactive" | "exec";
  profile?: string | undefined;
  profileV2?: string | undefined;
  approvalPolicy?: string | undefined;
  sandboxMode?: string | undefined;
  noAltScreen?: boolean | undefined;
  initialPromptProvided: boolean;
  terminalProvider?: string | undefined;
  terminalTargetId?: string | undefined;
}): Record<string, unknown> {
  const providerData: Record<string, unknown> = {
    interactive: input.mode === "interactive",
  };
  if (input.initialPromptProvided) {
    providerData.initialPromptProvided = true;
  }
  if (input.profile !== undefined) {
    providerData.profile = input.profile;
  }
  if (input.profileV2 !== undefined) {
    providerData.profileV2 = input.profileV2;
  }
  if (input.approvalPolicy !== undefined) {
    providerData.approvalPolicy = input.approvalPolicy;
  }
  if (input.sandboxMode !== undefined) {
    providerData.sandboxMode = input.sandboxMode;
  }
  if (input.noAltScreen === true) {
    providerData.noAltScreen = true;
  }
  if (input.terminalProvider !== undefined) {
    providerData.terminalProvider = input.terminalProvider;
  }
  if (input.terminalTargetId !== undefined) {
    providerData.terminalTargetId = input.terminalTargetId;
  }
  return providerData;
}
