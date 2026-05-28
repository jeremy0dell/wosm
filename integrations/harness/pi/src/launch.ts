import { fileURLToPath } from "node:url";
import type { BuildHarnessLaunchRequest, HarnessLaunchPlan } from "@wosm/contracts";
import { PiHarnessProviderError } from "./errors.js";

export type PiLaunchOptions = {
  command?: string;
  extensionPath?: string;
  configPath?: string;
};

export function buildPiLaunchPlan(
  request: BuildHarnessLaunchRequest,
  options: PiLaunchOptions = {},
): HarnessLaunchPlan {
  const mode = request.mode ?? "interactive";
  if (mode === "exec") {
    throw new PiHarnessProviderError(
      "HARNESS_PI_EXEC_UNSUPPORTED",
      "Pi exec mode is not supported by the interactive v1 harness provider.",
      {
        hint: "Use an interactive Pi session; JSON/RPC control is deferred to a later phase.",
      },
    );
  }

  const extensionPath = options.extensionPath ?? defaultPiExtensionPath();
  const args = ["--extension", extensionPath];
  if (request.initialPrompt !== undefined) {
    args.push(request.initialPrompt);
  }

  const providerDataInput: PiLaunchProviderDataInput = {
    extensionPath,
    initialPromptProvided: request.initialPrompt !== undefined,
  };
  if (request.terminalTarget !== undefined) {
    providerDataInput.terminalProvider = request.terminalTarget.provider;
    providerDataInput.terminalTargetId = request.terminalTarget.id;
  }
  if (options.configPath !== undefined) {
    providerDataInput.configPathProvided = true;
  }

  return {
    provider: "pi",
    command: options.command ?? "pi",
    args,
    cwd: request.worktree.path,
    env: piLaunchEnv(request, options),
    mode,
    displayTitle: `${request.project.label} Pi`,
    providerData: piProviderData(providerDataInput),
  };
}

function defaultPiExtensionPath(): string {
  return fileURLToPath(new URL("../dist/piExtension.js", import.meta.url));
}

function piLaunchEnv(
  request: BuildHarnessLaunchRequest,
  options: PiLaunchOptions,
): Record<string, string> {
  const env: Record<string, string> = {
    WOSM_PROJECT_ID: request.project.id,
    WOSM_WORKTREE_ID: request.worktree.id,
    WOSM_WORKTREE_PATH: request.worktree.path,
    WOSM_HARNESS_PROVIDER: "pi",
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
  return env;
}

type PiLaunchProviderDataInput = {
  extensionPath: string;
  initialPromptProvided: boolean;
  configPathProvided?: boolean | undefined;
  terminalProvider?: string | undefined;
  terminalTargetId?: string | undefined;
};

function piProviderData(input: PiLaunchProviderDataInput): Record<string, unknown> {
  const providerData: Record<string, unknown> = {
    interactive: true,
    extensionPath: input.extensionPath,
  };
  if (input.initialPromptProvided) {
    providerData.initialPromptProvided = true;
  }
  if (input.configPathProvided === true) {
    providerData.configPathProvided = true;
  }
  if (input.terminalProvider !== undefined) {
    providerData.terminalProvider = input.terminalProvider;
  }
  if (input.terminalTargetId !== undefined) {
    providerData.terminalTargetId = input.terminalTargetId;
  }
  return providerData;
}
