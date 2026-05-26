import type { TmuxConfig } from "@wosm/config";
import type { TerminalFocusOrigin } from "@wosm/contracts";
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
  preferRegisteredDevPopup?: boolean;
  runner?: ExternalCommandRunner;
  timeoutMs?: number;
  tuiCommand?: string;
  persistent?: boolean;
  uiSessionName?: string;
};

export type TmuxPopupResult = { opened: true } | { opened: false; closed: true };
export type TmuxPopupDismissResult = { dismissed: true } | { dismissed: false };
export type TmuxPersistentPopupSessionResult = { sessionName: string; created: boolean };
export type TmuxRegisteredDevPopupUi = {
  command: string;
  owner?: string;
  root?: string;
  sessionName: string;
};
type TmuxPersistentPopupUi = {
  command: string;
  registerFastPopup: boolean;
  sessionName: string;
};

const activePopupClientOption = "@wosm_popup_client";
const focusPopupClientOption = "@wosm_popup_focus_client";
const persistentUiSignatureOption = "@wosm_popup_ui_signature";
const registeredPopupExpectedSignatureOption = "@wosm_popup_ui_expected_signature";
const registeredPopupSessionNameOption = "@wosm_popup_ui_session_name";
const registeredDevPopupCommandOption = "@wosm_tui_dev_command";
const registeredDevPopupOwnerOption = "@wosm_tui_dev_owner";
const registeredDevPopupRootOption = "@wosm_tui_dev_root";
const registeredDevPopupSessionNameOption = "@wosm_tui_dev_session_name";
const defaultPersistentPopupSessionName = "_wosm-ui";
const defaultPersistentPopupTuiCommand = "wosm tui --popup --persistent";

export function buildTmuxPopupArgs(
  options: {
    command?: string;
    config?: TmuxConfig;
    focusClientId?: string;
    persistent?: boolean;
    popupState?: TmuxPopupState;
    tuiCommand?: string;
    uiSessionName?: string;
  } = {},
): string[] {
  const config = resolveTmuxWorkbenchConfig(options.config);
  const persistent = options.persistent !== false;
  const args = ["display-popup"];
  if (options.focusClientId !== undefined && options.focusClientId.length > 0) {
    args.push("-c", options.focusClientId);
  }
  args.push("-w", config.popupWidth, "-h", config.popupHeight);
  if (config.popupPosition.length > 0 && config.popupPosition !== "C") {
    args.push("-x", config.popupPosition);
  }
  const command = persistent
    ? buildPersistentPopupAttachCommand({
        tmuxCommand: options.command ?? "tmux",
        uiSessionName: options.uiSessionName ?? defaultPersistentPopupSessionName,
      })
    : buildPopupTuiCommand({
        ...(options.focusClientId === undefined ? {} : { focusClientId: options.focusClientId }),
        tuiCommand: options.tuiCommand ?? "wosm tui --popup",
      });
  args.push(
    "-E",
    options.popupState === undefined ? command : withPopupStateCleanup(command, options.popupState),
  );
  return args;
}

export async function openTmuxPopup(options: TmuxPopupOptions = {}): Promise<TmuxPopupResult> {
  const command = options.command ?? process.env.WOSM_TMUX_BIN ?? "tmux";
  const persistent = options.persistent !== false;
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
      await dismissTmuxPopup({
        command,
        focusClientId,
        ...(options.runner === undefined ? {} : { runner: options.runner }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      return { opened: false, closed: true };
    }
    if (activeClientId !== undefined) {
      await closeTmuxPopup({
        ...tmuxCommand,
        clientId: activeClientId,
      });
    }
    await setActivePopupClient({
      ...tmuxCommand,
      clientId: focusClientId,
    });
    await setFocusPopupClient({
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
  } else {
    await clearFocusPopupClient(tmuxCommand);
  }

  const persistentUi = persistent
    ? await resolvePersistentPopupUi(options, tmuxCommand)
    : undefined;

  if (persistentUi !== undefined) {
    await ensurePersistentPopupSession({
      command,
      ...(options.runner === undefined ? {} : { runner: options.runner }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      tuiCommand: persistentUi.command,
      uiSessionName: persistentUi.sessionName,
    });
    if (persistentUi.registerFastPopup) {
      await registerFastPopupUi(tmuxCommand, persistentUi).catch(() => undefined);
    }
  }

  const args = buildTmuxPopupArgs({
    command,
    ...(options.config === undefined ? {} : { config: options.config }),
    ...(focusClientId === undefined ? {} : { focusClientId }),
    persistent,
    ...(focusClientId === undefined
      ? {}
      : {
          popupState: {
            clientId: focusClientId,
            optionName: activePopupClientOption,
            focusOptionName: focusPopupClientOption,
            tmuxCommand: command,
          },
        }),
    ...(persistentUi === undefined
      ? options.tuiCommand === undefined
        ? {}
        : { tuiCommand: options.tuiCommand }
      : {
          tuiCommand: persistentUi.command,
          uiSessionName: persistentUi.sessionName,
        }),
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
      await clearFocusPopupClient(tmuxCommand).catch(() => undefined);
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

type TmuxPersistentPopupSessionOptions = Pick<
  TmuxPopupOptions,
  "command" | "runner" | "timeoutMs" | "tuiCommand" | "uiSessionName"
>;

export async function ensurePersistentPopupSession(
  options: TmuxPersistentPopupSessionOptions = {},
): Promise<TmuxPersistentPopupSessionResult> {
  const command = options.command ?? process.env.WOSM_TMUX_BIN ?? "tmux";
  const input = popupCommandInput(options, command);
  const sessionName = options.uiSessionName ?? defaultPersistentPopupSessionName;
  const tuiCommand = options.tuiCommand ?? defaultPersistentPopupTuiCommand;
  const signature = persistentPopupSignature(tuiCommand);
  if (await hasTmuxSession(input, sessionName)) {
    const currentSignature = await resolvePersistentPopupSessionSignature(input, sessionName);
    if (currentSignature === signature) {
      return { sessionName, created: false };
    }
    await killPersistentPopupSession(input, sessionName);
  }

  await runTmuxPopupCommand(input, {
    args: [
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-n",
      "wosm-ui",
      buildPersistentPopupTuiCommand(tuiCommand),
    ],
    operation: "provider.tmux.popup.createPersistentUi",
    message: "tmux failed to create the persistent wosm popup UI.",
    timeoutMessage: "tmux persistent popup UI creation timed out.",
  });
  await setPersistentPopupSessionSignature(input, {
    sessionName,
    signature,
  });
  return { sessionName, created: true };
}

export async function resolveRegisteredDevPopupUi(
  options: Pick<TmuxPopupOptions, "command" | "runner" | "timeoutMs"> = {},
): Promise<TmuxRegisteredDevPopupUi | undefined> {
  const input = popupCommandInput(options, options.command ?? process.env.WOSM_TMUX_BIN ?? "tmux");
  const sessionName = await resolveTmuxGlobalOption(input, registeredDevPopupSessionNameOption);
  const command = await resolveTmuxGlobalOption(input, registeredDevPopupCommandOption);
  if (sessionName === undefined || command === undefined) {
    return undefined;
  }

  const owner = await resolveTmuxGlobalOption(input, registeredDevPopupOwnerOption);
  if (owner !== undefined && !isRegisteredDevPopupOwnerAlive(owner)) {
    return undefined;
  }

  const root = await resolveTmuxGlobalOption(input, registeredDevPopupRootOption);
  const result: TmuxRegisteredDevPopupUi = {
    command,
    sessionName,
  };
  if (owner !== undefined) {
    result.owner = owner;
  }
  if (root !== undefined) {
    result.root = root;
  }
  return result;
}

export async function resolveTmuxPopupFocusOrigin(
  options: Pick<
    TmuxPopupOptions,
    "command" | "env" | "focusClientId" | "runner" | "timeoutMs"
  > = {},
): Promise<TerminalFocusOrigin | undefined> {
  const env = options.env ?? process.env;
  const clientId =
    nonEmptyString(options.focusClientId) ??
    nonEmptyString(env.WOSM_FOCUS_CLIENT_ID) ??
    (await resolveFocusPopupClient(
      popupCommandInput(options, options.command ?? process.env.WOSM_TMUX_BIN ?? "tmux"),
    ));
  if (clientId === undefined) {
    return undefined;
  }
  return {
    provider: "tmux",
    clientId,
  };
}

export async function dismissTmuxPopup(
  options: Pick<
    TmuxPopupOptions,
    "command" | "env" | "focusClientId" | "runner" | "timeoutMs"
  > = {},
): Promise<TmuxPopupDismissResult> {
  const env = options.env ?? process.env;
  const command = options.command ?? process.env.WOSM_TMUX_BIN ?? "tmux";
  const input = popupCommandInput(options, command);
  const clientId =
    nonEmptyString(options.focusClientId) ??
    nonEmptyString(env.WOSM_FOCUS_CLIENT_ID) ??
    (await resolveFocusPopupClient(input)) ??
    (await resolveActivePopupClient(input));
  if (clientId === undefined) {
    await clearActivePopupClient(input).catch(() => undefined);
    await clearFocusPopupClient(input).catch(() => undefined);
    return { dismissed: false };
  }
  await closeTmuxPopup({
    ...input,
    clientId,
  });
  await clearActivePopupClient(input);
  await clearFocusPopupClient(input);
  return { dismissed: true };
}

type TmuxPopupState = {
  clientId: string;
  focusOptionName?: string;
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

function buildPopupTuiCommand(options: { focusClientId?: string; tuiCommand: string }): string {
  const envAssignments = ["WOSM_TUI_POPUP=1", "WOSM_FOCUS_PROVIDER=tmux"];
  if (options.focusClientId !== undefined && options.focusClientId.length > 0) {
    envAssignments.push(`WOSM_FOCUS_CLIENT_ID=${quoteEnvValue(options.focusClientId)}`);
  }
  return ["env", ...envAssignments, options.tuiCommand].join(" ");
}

function buildPersistentPopupTuiCommand(tuiCommand: string): string {
  return ["env", "WOSM_TUI_POPUP=1", "WOSM_FOCUS_PROVIDER=tmux", tuiCommand].join(" ");
}

function persistentPopupSignature(tuiCommand: string): string {
  return `v1:${tuiCommand}`;
}

function buildPersistentPopupAttachCommand(options: {
  tmuxCommand: string;
  uiSessionName: string;
}): string {
  return `env -u TMUX ${quoteShellValue(options.tmuxCommand)} attach-session -t ${quoteShellValue(
    options.uiSessionName,
  )}`;
}

function withPopupStateCleanup(command: string, popupState: TmuxPopupState): string {
  const cleanupScript = buildPopupCleanupScript(popupState);
  return `sh -lc ${shellQuote(`trap ${shellQuote(cleanupScript)} EXIT; ${command}`)}`;
}

function buildPopupCleanupScript(options: TmuxPopupState): string {
  const tmuxCommand = shellQuote(options.tmuxCommand);
  const optionName = shellQuote(options.optionName);
  const focusOptionName =
    options.focusOptionName === undefined ? undefined : shellQuote(options.focusOptionName);
  const clientId = shellQuote(options.clientId);
  const commands = [
    `if [ "$(${tmuxCommand} show-options -gqv ${optionName} 2>/dev/null)" = ${clientId} ]; then`,
    `${tmuxCommand} set-option -gq -u ${optionName};`,
    "fi;",
  ];
  if (focusOptionName !== undefined) {
    commands.push(
      `if [ "$(${tmuxCommand} show-options -gqv ${focusOptionName} 2>/dev/null)" = ${clientId} ]; then`,
      `${tmuxCommand} set-option -gq -u ${focusOptionName};`,
      "fi;",
    );
  }
  return commands.join(" ");
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

async function resolvePersistentPopupUi(
  options: Pick<TmuxPopupOptions, "preferRegisteredDevPopup" | "tuiCommand" | "uiSessionName">,
  input: TmuxPopupCommandInput,
): Promise<TmuxPersistentPopupUi> {
  if (options.preferRegisteredDevPopup === true) {
    const registered = await resolveRegisteredDevPopupUi(input);
    if (registered !== undefined) {
      return {
        command: registered.command,
        registerFastPopup: false,
        sessionName: registered.sessionName,
      };
    }
  }
  return {
    command: options.tuiCommand ?? defaultPersistentPopupTuiCommand,
    registerFastPopup: true,
    sessionName: options.uiSessionName ?? defaultPersistentPopupSessionName,
  };
}

async function registerFastPopupUi(
  input: TmuxPopupCommandInput,
  ui: TmuxPersistentPopupUi,
): Promise<void> {
  await setTmuxGlobalOption(input, registeredPopupSessionNameOption, ui.sessionName);
  await setTmuxGlobalOption(
    input,
    registeredPopupExpectedSignatureOption,
    persistentPopupSignature(ui.command),
  );
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
          args: ["show-options", "-gqv", activePopupClientOption],
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

async function resolveTmuxGlobalOption(
  input: TmuxPopupCommandInput,
  optionName: string,
): Promise<string | undefined> {
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: "provider.tmux.popup.globalOption",
      timeoutMs: input.timeoutMs ?? 5000,
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_POPUP_FAILED",
        message: "tmux failed to resolve a wosm popup option.",
        provider: "tmux",
      },
      timeoutError: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TMUX_TIMEOUT",
        message: "tmux popup option lookup timed out.",
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
          args: ["show-options", "-gqv", optionName],
          signal,
          maxOutputChars: 4096,
        },
        input.runner,
      ),
  );
  if (!result.ok) {
    return undefined;
  }
  const value = result.value.stdout.trim();
  return value.length === 0 ? undefined : value;
}

async function resolvePersistentPopupSessionSignature(
  input: TmuxPopupCommandInput,
  sessionName: string,
): Promise<string | undefined> {
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: "provider.tmux.popup.persistentUiSignature",
      timeoutMs: input.timeoutMs ?? 5000,
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_POPUP_FAILED",
        message: "tmux failed to resolve the persistent wosm popup UI signature.",
        provider: "tmux",
      },
      timeoutError: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TMUX_TIMEOUT",
        message: "tmux persistent popup UI signature lookup timed out.",
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
          args: ["show-options", "-t", sessionName, "-qv", persistentUiSignatureOption],
          signal,
          maxOutputChars: 4096,
        },
        input.runner,
      ),
  );
  if (!result.ok) {
    return undefined;
  }
  const signature = result.value.stdout.trim();
  return signature.length === 0 ? undefined : signature;
}

async function setPersistentPopupSessionSignature(
  input: TmuxPopupCommandInput,
  options: { sessionName: string; signature: string },
): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: [
      "set-option",
      "-t",
      options.sessionName,
      "-q",
      persistentUiSignatureOption,
      options.signature,
    ],
    operation: "provider.tmux.popup.setPersistentUiSignature",
    message: "tmux failed to record the persistent wosm popup UI signature.",
    timeoutMessage: "tmux persistent popup UI signature update timed out.",
  });
}

async function killPersistentPopupSession(
  input: TmuxPopupCommandInput,
  sessionName: string,
): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: ["kill-session", "-t", sessionName],
    operation: "provider.tmux.popup.killPersistentUi",
    message: "tmux failed to replace the persistent wosm popup UI.",
    timeoutMessage: "tmux persistent popup UI replacement timed out.",
  });
}

async function resolveFocusPopupClient(input: TmuxPopupCommandInput): Promise<string | undefined> {
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: "provider.tmux.popup.focusClient",
      timeoutMs: input.timeoutMs ?? 5000,
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_POPUP_FAILED",
        message: "tmux failed to resolve the wosm popup focus client.",
        provider: "tmux",
      },
      timeoutError: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TMUX_TIMEOUT",
        message: "tmux popup focus client lookup timed out.",
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
          args: ["show-options", "-gqv", focusPopupClientOption],
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
    args: ["set-option", "-gq", activePopupClientOption, input.clientId],
    operation: "provider.tmux.popup.setActiveClient",
    message: "tmux failed to record the active wosm popup.",
    timeoutMessage: "tmux active popup update timed out.",
  });
}

async function setFocusPopupClient(
  input: TmuxPopupCommandInput & { clientId: string },
): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: ["set-option", "-gq", focusPopupClientOption, input.clientId],
    operation: "provider.tmux.popup.setFocusClient",
    message: "tmux failed to record the wosm popup focus client.",
    timeoutMessage: "tmux popup focus client update timed out.",
  });
}

async function setTmuxGlobalOption(
  input: TmuxPopupCommandInput,
  optionName: string,
  value: string,
): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: ["set-option", "-gq", optionName, value],
    operation: "provider.tmux.popup.setGlobalOption",
    message: "tmux failed to record a wosm popup option.",
    timeoutMessage: "tmux popup option update timed out.",
  });
}

async function clearActivePopupClient(input: TmuxPopupCommandInput): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: ["set-option", "-gq", "-u", activePopupClientOption],
    operation: "provider.tmux.popup.clearActiveClient",
    message: "tmux failed to clear the active wosm popup.",
    timeoutMessage: "tmux active popup clear timed out.",
  });
}

async function clearFocusPopupClient(input: TmuxPopupCommandInput): Promise<void> {
  await runTmuxPopupCommand(input, {
    args: ["set-option", "-gq", "-u", focusPopupClientOption],
    operation: "provider.tmux.popup.clearFocusClient",
    message: "tmux failed to clear the wosm popup focus client.",
    timeoutMessage: "tmux popup focus client clear timed out.",
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

function isRegisteredDevPopupOwnerAlive(owner: string): boolean {
  const [pidText] = owner.split(":");
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ((error as { code?: unknown }).code === "ESRCH" ||
        (error as { code?: unknown }).code === "EINVAL")
    ) {
      return false;
    }
    return true;
  }
}

function quoteEnvValue(value: string): string {
  return quoteShellValue(value);
}

function quoteShellValue(value: string): string {
  return /^[A-Za-z0-9_@%+=,./:-]+$/.test(value) ? value : shellQuote(value);
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
