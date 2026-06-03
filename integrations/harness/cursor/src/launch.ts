import type { BuildHarnessLaunchRequest, HarnessLaunchPlan } from "@wosm/contracts";
import { CursorHarnessProviderError } from "./errors.js";

export type CursorLaunchOptions = {
  command?: string;
};

function cursorLaunchEnv(request: BuildHarnessLaunchRequest): Record<string, string> {
  const env: Record<string, string> = {
    WOSM_PROJECT_ID: request.project.id,
    WOSM_WORKTREE_ID: request.worktree.id,
    WOSM_WORKTREE_PATH: request.worktree.path,
    WOSM_HARNESS_PROVIDER: "cursor",
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

function cursorProviderData(input: {
  initialPromptProvided: boolean;
  terminalProvider?: string;
  terminalTargetId?: string;
}): Record<string, unknown> {
  const providerData: Record<string, unknown> = {
    interactive: true,
    observation: "hooks",
  };
  if (input.initialPromptProvided) {
    providerData.initialPromptProvided = true;
  }
  if (input.terminalProvider !== undefined) {
    providerData.terminalProvider = input.terminalProvider;
  }
  if (input.terminalTargetId !== undefined) {
    providerData.terminalTargetId = input.terminalTargetId;
  }
  return providerData;
}

export function buildCursorLaunchPlan(
  request: BuildHarnessLaunchRequest,
  options: CursorLaunchOptions = {},
): HarnessLaunchPlan {
  const mode = request.mode ?? "interactive";
  if (mode === "exec") {
    throw new CursorHarnessProviderError(
      "HARNESS_CURSOR_EXEC_UNSUPPORTED",
      "Cursor exec mode is not supported by the hook-only Cursor harness provider.",
      {
        hint: "Use an interactive Cursor agent session; headless stream-json support is intentionally out of scope for this provider slice.",
      },
    );
  }

  const args = ["--workspace", request.worktree.path];
  if (request.initialPrompt !== undefined) {
    args.push(request.initialPrompt);
  }

  const providerDataInput: Parameters<typeof cursorProviderData>[0] = {
    initialPromptProvided: request.initialPrompt !== undefined,
  };
  if (request.terminalTarget !== undefined) {
    providerDataInput.terminalProvider = request.terminalTarget.provider;
    providerDataInput.terminalTargetId = request.terminalTarget.id;
  }

  return {
    provider: "cursor",
    command: options.command ?? "agent",
    args,
    cwd: request.worktree.path,
    env: cursorLaunchEnv(request),
    mode,
    displayTitle: `${request.project.label} Cursor`,
    providerData: cursorProviderData(providerDataInput),
  };
}
