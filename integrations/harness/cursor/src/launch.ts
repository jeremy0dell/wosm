import type { BuildHarnessLaunchRequest, HarnessLaunchPlan } from "@wosm/contracts";
import { CursorHarnessProviderError } from "./errors.js";

export type CursorLaunchOptions = {
  command?: string;
};

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

  return {
    provider: "cursor",
    command: options.command ?? "agent",
    args,
    cwd: request.worktree.path,
    env: cursorLaunchEnv(request),
    mode,
    displayTitle: `${request.project.label} Cursor`,
    providerData: cursorProviderData({
      initialPromptProvided: request.initialPrompt !== undefined,
      terminalProvider: request.terminalTarget?.provider,
      terminalTargetId: request.terminalTarget?.id,
    }),
  };
}

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
  terminalProvider?: string | undefined;
  terminalTargetId?: string | undefined;
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
