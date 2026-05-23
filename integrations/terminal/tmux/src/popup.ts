import type { TmuxConfig } from "@wosm/config";
import {
  type ExternalCommandRunner,
  runExternalCommand,
  runRuntimeBoundaryWithRetry,
  runRuntimeBoundaryWithRetryAndTimeout,
} from "@wosm/runtime";
import { tmuxProviderErrorFromUnknown } from "./errors.js";
import {
  defaultTmuxWorkbenchSessionOptions,
  resolveTmuxWorkbenchConfig,
  tmuxSessionOptionArgs,
} from "./topology.js";

export type TmuxPopupOptions = {
  command?: string;
  config?: TmuxConfig;
  enterWorkbench?: boolean;
  env?: Record<string, string | undefined>;
  focusClientId?: string;
  runner?: ExternalCommandRunner;
  timeoutMs?: number;
  tuiCommand?: string;
};

export type TmuxPopupResult = { opened: true } | { opened: false; closed: true };

const activePopupClientOption = "@wosm_popup_client";

export function buildTmuxPopupArgs(
  options: {
    config?: TmuxConfig;
    focusClientId?: string;
    popupState?: TmuxPopupState;
    tuiCommand?: string;
  } = {},
): string[] {
  const config = resolveTmuxWorkbenchConfig(options.config);
  const args = ["display-popup"];
  if (options.focusClientId !== undefined && options.focusClientId.length > 0) {
    args.push("-c", options.focusClientId);
  }
  args.push("-w", config.popupWidth, "-h", config.popupHeight);
  if (config.popupPosition.length > 0 && config.popupPosition !== "C") {
    args.push("-x", config.popupPosition);
  }
  const commandOptions: {
    focusClientId?: string;
    popupState?: TmuxPopupState;
    tuiCommand: string;
  } = {
    tuiCommand: options.tuiCommand ?? "wosm tui --popup",
  };
  if (options.focusClientId !== undefined) {
    commandOptions.focusClientId = options.focusClientId;
  }
  if (options.popupState !== undefined) {
    commandOptions.popupState = options.popupState;
  }
  args.push("-E", buildPopupTuiCommand(commandOptions));
  return args;
}

export async function openTmuxPopup(options: TmuxPopupOptions = {}): Promise<TmuxPopupResult> {
  const command = options.command ?? process.env.WOSM_TMUX_BIN ?? "tmux";
  const currentClientInput: {
    command: string;
    env: Record<string, string | undefined>;
    runner?: ExternalCommandRunner;
    timeoutMs?: number;
  } = {
    command,
    env: options.env ?? process.env,
  };
  if (options.runner !== undefined) {
    currentClientInput.runner = options.runner;
  }
  if (options.timeoutMs !== undefined) {
    currentClientInput.timeoutMs = options.timeoutMs;
  }
  const focusClientId =
    nonEmptyString(options.focusClientId) ??
    nonEmptyString(currentClientInput.env.WOSM_FOCUS_CLIENT_ID) ??
    (await resolveCurrentTmuxClientId(currentClientInput));
  const tmuxCommand = popupCommandInput(options, command);
  if (focusClientId !== undefined && focusClientId.length > 0) {
    const activeClientId = await resolveActivePopupClient(tmuxCommand);
    if (activeClientId === focusClientId) {
      await closeTmuxPopup({
        ...tmuxCommand,
        clientId: focusClientId,
      });
      await clearActivePopupClient(tmuxCommand);
      return { opened: false, closed: true };
    }
    await setActivePopupClient({
      ...tmuxCommand,
      clientId: focusClientId,
    });
    if (options.enterWorkbench === true) {
      const enterInput: TmuxPopupCommandInput & { clientId: string; config?: TmuxConfig } = {
        ...tmuxCommand,
        clientId: focusClientId,
      };
      if (options.config !== undefined) {
        enterInput.config = options.config;
      }
      await enterWorkbenchForPopup(enterInput);
    }
  }

  const args = buildTmuxPopupArgs({
    ...(options.config === undefined ? {} : { config: options.config }),
    ...(focusClientId === undefined ? {} : { focusClientId }),
    ...(focusClientId === undefined
      ? {}
      : {
          popupState: {
            clientId: focusClientId,
            optionName: activePopupClientOption,
            tmuxCommand: command,
          },
        }),
    ...(options.tuiCommand === undefined ? {} : { tuiCommand: options.tuiCommand }),
  });
  const result = await runRuntimeBoundaryWithRetry(
    {
      operation: "provider.tmux.popup",
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_POPUP_FAILED",
        message: "tmux failed to open the wosm popup.",
        provider: "tmux",
      },
      retry: {
        retries: 0,
      },
    },
    ({ signal }) =>
      runExternalCommand(
        {
          command,
          args,
          signal,
          maxOutputChars: 64 * 1024,
        },
        options.runner,
      ),
  );

  if (!result.ok) {
    if (focusClientId !== undefined && focusClientId.length > 0) {
      await clearActivePopupClient(tmuxCommand).catch(() => undefined);
    }
    if (isPopupDismissed(result.error)) {
      return { opened: true };
    }
    throw tmuxProviderErrorFromUnknown(result.error, {
      code: "TERMINAL_OPEN_FAILED",
      message: "tmux failed to open the wosm popup.",
    });
  }

  return { opened: true };
}

type TmuxPopupState = {
  clientId: string;
  optionName: string;
  tmuxCommand: string;
};

type TmuxPopupCommandInput = {
  command: string;
  runner?: ExternalCommandRunner;
  timeoutMs?: number;
};

type WorkbenchTarget = {
  sessionId: string;
  windowId?: string;
  paneId?: string;
};

function buildPopupTuiCommand(options: {
  focusClientId?: string;
  popupState?: TmuxPopupState;
  tuiCommand: string;
}): string {
  const envAssignments = ["WOSM_TUI_POPUP=1", "WOSM_FOCUS_PROVIDER=tmux"];
  if (options.focusClientId !== undefined && options.focusClientId.length > 0) {
    envAssignments.push(`WOSM_FOCUS_CLIENT_ID=${quoteEnvValue(options.focusClientId)}`);
  }
  const tuiCommand = ["env", ...envAssignments, options.tuiCommand].join(" ");
  if (options.popupState === undefined) {
    return tuiCommand;
  }
  const cleanupScript = buildPopupCleanupScript(options.popupState);
  return `sh -lc ${shellQuote(`trap ${shellQuote(cleanupScript)} EXIT; ${tuiCommand}`)}`;
}

function buildPopupCleanupScript(options: TmuxPopupState): string {
  const tmuxCommand = shellQuote(options.tmuxCommand);
  const optionName = shellQuote(options.optionName);
  const clientId = shellQuote(options.clientId);
  return [
    `if [ "$(${tmuxCommand} show-options -sqv ${optionName} 2>/dev/null)" = ${clientId} ]; then`,
    `${tmuxCommand} set-option -sq -u ${optionName};`,
    "fi",
  ].join(" ");
}

function popupCommandInput(
  options: Pick<TmuxPopupOptions, "runner" | "timeoutMs">,
  command: string,
): TmuxPopupCommandInput {
  const input: TmuxPopupCommandInput = {
    command,
  };
  if (options.runner !== undefined) {
    input.runner = options.runner;
  }
  if (options.timeoutMs !== undefined) {
    input.timeoutMs = options.timeoutMs;
  }
  return input;
}

async function resolveActivePopupClient(input: TmuxPopupCommandInput): Promise<string | undefined> {
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: "provider.tmux.popup.activeClient",
      timeoutMs: input.timeoutMs ?? 5000,
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_POPUP_FAILED",
        message: "tmux failed to resolve the active wosm popup.",
        provider: "tmux",
      },
      timeoutError: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TMUX_TIMEOUT",
        message: "tmux active popup lookup timed out.",
        provider: "tmux",
      },
      retry: {
        retries: 0,
      },
    },
    ({ signal }) =>
      runExternalCommand(
        {
          command: input.command,
          args: ["show-options", "-sqv", activePopupClientOption],
          signal,
          maxOutputChars: 4096,
        },
        input.runner,
      ),
  );
  if (!result.ok) {
    return undefined;
  }
  const clientId = result.value.stdout.trim();
  return clientId.length === 0 ? undefined : clientId;
}

async function setActivePopupClient(
  input: TmuxPopupCommandInput & { clientId: string },
): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: ["set-option", "-sq", activePopupClientOption, input.clientId],
    operation: "provider.tmux.popup.setActiveClient",
    message: "tmux failed to record the active wosm popup.",
    timeoutMessage: "tmux active popup update timed out.",
  });
}

async function clearActivePopupClient(input: TmuxPopupCommandInput): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: ["set-option", "-sq", "-u", activePopupClientOption],
    operation: "provider.tmux.popup.clearActiveClient",
    message: "tmux failed to clear the active wosm popup.",
    timeoutMessage: "tmux active popup clear timed out.",
  });
}

async function closeTmuxPopup(input: TmuxPopupCommandInput & { clientId: string }): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: ["display-popup", "-c", input.clientId, "-C"],
    operation: "provider.tmux.popup.close",
    message: "tmux failed to close the active wosm popup.",
    timeoutMessage: "tmux popup close timed out.",
  });
}

async function enterWorkbenchForPopup(
  input: TmuxPopupCommandInput & { clientId: string; config?: TmuxConfig },
): Promise<void> {
  const config = resolveTmuxWorkbenchConfig(input.config);
  const target = await resolveWorkbenchTarget(input, config.workbenchSession);
  await switchClientToWorkbench({ ...input, target });
}

async function resolveWorkbenchTarget(
  input: TmuxPopupCommandInput,
  sessionId: string,
): Promise<WorkbenchTarget> {
  const sessionExists = await hasTmuxSession(input, sessionId);
  if (!sessionExists) {
    await runTmuxPopupCommand(input, {
      args: ["new-session", "-d", "-s", sessionId, "-n", "wosm"],
      operation: "provider.tmux.popup.createWorkbench",
      message: "tmux failed to create the wosm workbench.",
      timeoutMessage: "tmux workbench creation timed out.",
    });
    await configureWorkbenchSession(input, sessionId);
    return { sessionId };
  }

  await configureWorkbenchSession(input, sessionId);

  const agentTarget = await firstLiveAgentPane(input, sessionId);
  if (agentTarget !== undefined) {
    return agentTarget;
  }

  const firstWindow = await firstWorkbenchWindow(input, sessionId);
  return firstWindow ?? { sessionId };
}

async function hasTmuxSession(input: TmuxPopupCommandInput, sessionId: string): Promise<boolean> {
  try {
    await runTmuxPopupCommand(input, {
      args: ["has-session", "-t", sessionId],
      operation: "provider.tmux.popup.hasWorkbench",
      message: "tmux failed to inspect the wosm workbench.",
      timeoutMessage: "tmux workbench inspection timed out.",
    });
    return true;
  } catch {
    return false;
  }
}

async function configureWorkbenchSession(
  input: TmuxPopupCommandInput,
  sessionId: string,
): Promise<void> {
  for (const option of defaultTmuxWorkbenchSessionOptions) {
    await runTmuxPopupCommand(input, {
      args: tmuxSessionOptionArgs(sessionId, option),
      operation: "provider.tmux.popup.configureWorkbench",
      message: "tmux failed to configure the wosm workbench.",
      timeoutMessage: "tmux workbench configuration timed out.",
    });
  }
}

async function firstLiveAgentPane(
  input: TmuxPopupCommandInput,
  sessionId: string,
): Promise<WorkbenchTarget | undefined> {
  const output = await runTmuxPopupQuery(input, {
    args: [
      "list-panes",
      "-s",
      "-t",
      sessionId,
      "-F",
      "#{window_id}\t#{pane_id}\t#{pane_dead}\t#{@wosm.role}",
    ],
    operation: "provider.tmux.popup.listWorkbenchPanes",
    message: "tmux failed to inspect wosm workbench panes.",
    timeoutMessage: "tmux workbench pane inspection timed out.",
  });
  for (const line of output.stdout.split(/\r?\n/)) {
    const [windowId = "", paneId = "", paneDead = "", role = ""] = line.split("\t");
    if (windowId.length > 0 && paneId.length > 0 && paneDead !== "1" && role === "main-agent") {
      return { sessionId, windowId, paneId };
    }
  }
  return undefined;
}

async function firstWorkbenchWindow(
  input: TmuxPopupCommandInput,
  sessionId: string,
): Promise<WorkbenchTarget | undefined> {
  const output = await runTmuxPopupQuery(input, {
    args: ["list-windows", "-t", sessionId, "-F", "#{window_id}"],
    operation: "provider.tmux.popup.listWorkbenchWindows",
    message: "tmux failed to inspect wosm workbench windows.",
    timeoutMessage: "tmux workbench window inspection timed out.",
  });
  const windowId = output.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return windowId === undefined ? undefined : { sessionId, windowId };
}

async function switchClientToWorkbench(
  input: TmuxPopupCommandInput & { clientId: string; target: WorkbenchTarget },
): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: ["switch-client", "-c", input.clientId, "-t", input.target.sessionId],
    operation: "provider.tmux.popup.enterWorkbench",
    message: "tmux failed to enter the wosm workbench.",
    timeoutMessage: "tmux workbench focus timed out.",
  });
  if (input.target.windowId !== undefined) {
    await runTmuxPopupCommand(input, {
      args: ["select-window", "-t", `${input.target.sessionId}:${input.target.windowId}`],
      operation: "provider.tmux.popup.enterWorkbench",
      message: "tmux failed to select the wosm workbench window.",
      timeoutMessage: "tmux workbench window focus timed out.",
    });
  }
  if (input.target.paneId !== undefined) {
    await runTmuxPopupCommand(input, {
      args: ["select-pane", "-t", input.target.paneId],
      operation: "provider.tmux.popup.enterWorkbench",
      message: "tmux failed to select the wosm workbench pane.",
      timeoutMessage: "tmux workbench pane focus timed out.",
    });
  }
}

async function runTmuxPopupCommand(
  input: TmuxPopupCommandInput,
  options: { args: string[]; operation: string; message: string; timeoutMessage: string },
): Promise<void> {
  await runTmuxPopupQuery(input, options);
}

async function runTmuxPopupQuery(
  input: TmuxPopupCommandInput,
  options: { args: string[]; operation: string; message: string; timeoutMessage: string },
) {
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: options.operation,
      timeoutMs: input.timeoutMs ?? 5000,
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_POPUP_FAILED",
        message: options.message,
        provider: "tmux",
      },
      timeoutError: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TMUX_TIMEOUT",
        message: options.timeoutMessage,
        provider: "tmux",
      },
      retry: {
        retries: 0,
      },
    },
    ({ signal }) =>
      runExternalCommand(
        {
          command: input.command,
          args: options.args,
          signal,
          maxOutputChars: 4096,
        },
        input.runner,
      ),
  );

  if (!result.ok) {
    throw tmuxProviderErrorFromUnknown(result.error, {
      code: "TERMINAL_OPEN_FAILED",
      message: options.message,
    });
  }

  return result.value;
}

async function resolveCurrentTmuxClientId(input: {
  command: string;
  env: Record<string, string | undefined>;
  runner?: ExternalCommandRunner;
  timeoutMs?: number;
}): Promise<string | undefined> {
  if (input.env.TMUX === undefined || input.env.TMUX.length === 0) {
    return undefined;
  }
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: "provider.tmux.popup.currentClient",
      timeoutMs: input.timeoutMs ?? 5000,
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_POPUP_FAILED",
        message: "tmux failed to resolve the current client for the wosm popup.",
        provider: "tmux",
      },
      timeoutError: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TMUX_TIMEOUT",
        message: "tmux current client lookup timed out.",
        provider: "tmux",
      },
      retry: {
        retries: 0,
      },
    },
    ({ signal }) =>
      runExternalCommand(
        {
          command: input.command,
          args: ["display-message", "-p", "#{client_name}"],
          signal,
          maxOutputChars: 4096,
        },
        input.runner,
      ),
  );
  if (!result.ok) {
    return undefined;
  }
  const clientId = result.value.stdout.trim();
  return clientId.length === 0 ? undefined : clientId;
}

function isPopupDismissed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    (error as { exitCode?: unknown }).exitCode === 129
  );
}

function quoteEnvValue(value: string): string {
  return /^[A-Za-z0-9_@%+=,./:-]+$/.test(value) ? value : shellQuote(value);
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
