#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@wosm/config";
import { parseRequiredOptionValue } from "./args.js";
import type { CodexHooksCommandOptions } from "./commands/codexHooks.js";
import { runCodexHooksCommand } from "./commands/codexHooks.js";
import type { CommandCommandOptions } from "./commands/command.js";
import { commandCommandExitCode, runCommandCommand } from "./commands/command.js";
import {
  isConfigError,
  runInvalidConfigDebugBundle,
  runInvalidConfigDoctor,
} from "./commands/configDiagnostics.js";
import type { CursorHooksCommandOptions } from "./commands/cursorHooks.js";
import { runCursorHooksCommand } from "./commands/cursorHooks.js";
import { runDebugBundleCommand } from "./commands/debugBundle.js";
import { runDebugTraceCommand } from "./commands/debugTrace.js";
import { runDoctorCommand } from "./commands/doctor.js";
import type { EventHooksCommandOptions } from "./commands/eventHooks.js";
import { runEventHooksCommand } from "./commands/eventHooks.js";
import type { NotifyCommandOptions } from "./commands/notify.js";
import { type NotifyCommandDeps, runNotifyCommand } from "./commands/notify.js";
import {
  type ObserveCommandDeps,
  type ObserveCommandOptions,
  runObserveCommand,
} from "./commands/observe/index.js";
import { observerCommandSummary, runObserverCommand } from "./commands/observer.js";
import type { OpenCodeHooksCommandOptions } from "./commands/opencodeHooks.js";
import { runOpenCodeHooksCommand } from "./commands/opencodeHooks.js";
import {
  type PopupCommandDeps,
  type PopupCommandOptions,
  runPopupCommand,
} from "./commands/popup.js";
import {
  type ProjectCommandOptions,
  projectCommandExitCode,
  runProjectCommand,
} from "./commands/project.js";
import { runReconcileCommand } from "./commands/reconcile.js";
import { runSnapshotCommand } from "./commands/snapshot.js";
import { runTuiCommand, type TuiCommandDeps } from "./commands/tui.js";
import { runWorktrunkHooksCommand } from "./commands/worktrunkHooks.js";
import type { CliEnv } from "./env.js";
import type { ObserverProcessDeps } from "./observerProcess.js";
import { readStdinIfAvailable } from "./stdin.js";

export type CliRunResult = {
  code: number;
  output?: unknown;
};

export type CliRunOptions = {
  stdin?: string;
  env?: CliEnv;
  observerDeps?: ObserverProcessDeps;
  popupDeps?: PopupCommandDeps;
  tuiDeps?: TuiCommandDeps;
  notifyDeps?: NotifyCommandDeps;
  observeDeps?: ObserveCommandDeps;
};

const configBackedCommands = [
  "doctor",
  "event-hooks",
  "hooks",
  "command",
  "observer",
  "observe",
  "popup",
  "project",
  "reconcile",
  "snapshot",
  "tui",
  "worktrunk",
] as const;

const topLevelCommands = ["debug", "notify", ...configBackedCommands] as const;

export async function runCli(
  argv = process.argv.slice(2),
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  const { args, configPath } = parseGlobalOptions(argv);
  const command = args[0] ?? defaultCommand(defaultCommandEnv(options));
  const commandArgs = args[0] === undefined ? [] : args.slice(1);
  let loaded: Awaited<ReturnType<typeof loadConfig>> | undefined;
  try {
    loaded = commandRequiresConfig(command, commandArgs)
      ? configPath === undefined
        ? await loadConfig()
        : await loadConfig(configPath)
      : undefined;
  } catch (error) {
    if (isConfigError(error) && command === "doctor") {
      const result = await runInvalidConfigDoctor({
        error,
        configPath: error.configPath,
      });
      return { code: 1, output: result };
    }
    if (isConfigError(error) && command === "debug" && commandArgs[0] === "bundle") {
      const result = await runInvalidConfigDebugBundle({
        error,
        configPath: error.configPath,
      });
      return { code: 0, output: result };
    }
    throw error;
  }
  const config = loaded?.config;
  const resolvedConfigPath = loaded?.configPath;

  if (command === "observer") {
    const result = await runObserverCommand(
      commandArgs,
      loadedCommandOptions(config, resolvedConfigPath),
      options.observerDeps,
    );
    return { code: 0, output: observerCommandSummary(result) };
  }

  if (command === "doctor") {
    const result = await runDoctorCommand(
      commandArgs,
      loadedCommandOptions(config, resolvedConfigPath),
      options.observerDeps,
    );
    return { code: result.status === "unavailable" ? 1 : 0, output: result };
  }

  if (command === "debug" && commandArgs[0] === "bundle") {
    const result = await runDebugBundleCommand(
      commandArgs.slice(1),
      loadedCommandOptions(config, resolvedConfigPath),
      options.observerDeps,
    );
    return { code: 0, output: result };
  }

  if (command === "debug" && commandArgs[0] === "trace") {
    const result = await runDebugTraceCommand(commandArgs.slice(1), loadedCommandOptions(config));
    return { code: result.matched ? 0 : 1, output: result };
  }

  if (command === "notify") {
    const stdin = options.stdin ?? (await readStdinIfAvailable());
    const notifyOptions: NotifyCommandOptions = {};
    if (stdin !== undefined) {
      notifyOptions.stdin = stdin;
    }
    if (configPath !== undefined) {
      notifyOptions.configPath = configPath;
    }
    const result = await runNotifyCommand(commandArgs, notifyOptions, options.notifyDeps);
    return { code: 0, output: result };
  }

  if (command === "event-hooks") {
    const eventHookOptions: EventHooksCommandOptions = loadedCommandOptions(
      config,
      resolvedConfigPath,
    );
    if (options.env !== undefined) {
      eventHookOptions.env = options.env;
    }
    const result = await runEventHooksCommand(commandArgs, eventHookOptions);
    return { code: hookCommandExitCode(result), output: result };
  }

  if (command === "observe") {
    const observeOptions: ObserveCommandOptions = loadedCommandOptions(config, resolvedConfigPath);
    const observeDeps: ObserveCommandDeps = {};
    if (options.observeDeps !== undefined) {
      Object.assign(observeDeps, options.observeDeps);
    }
    if (options.observerDeps !== undefined && observeDeps.observer === undefined) {
      observeDeps.observer = options.observerDeps;
    }
    const result = await runObserveCommand(commandArgs, observeOptions, observeDeps);
    return { code: result.code };
  }

  if (command === "command") {
    const stdin = commandArgs.includes("--stdin")
      ? (options.stdin ?? (await readStdinIfAvailable()))
      : options.stdin;
    const commandOptions: CommandCommandOptions = loadedCommandOptions(config, resolvedConfigPath);
    if (stdin !== undefined) {
      commandOptions.stdin = stdin;
    }
    const result = await runCommandCommand(commandArgs, commandOptions, options.observerDeps);
    return { code: commandCommandExitCode(result), output: result };
  }

  if (command === "popup") {
    const popupEnv = options.popupDeps?.env ?? options.env;
    const defaultPopupEnv = popupEnv ?? process.env;
    const hasExplicitPopupUi =
      options.popupDeps?.tuiCommand !== undefined ||
      options.popupDeps?.uiSessionName !== undefined ||
      nonEmptyString(defaultPopupEnv.WOSM_TUI_COMMAND) !== undefined ||
      nonEmptyString(defaultPopupEnv.WOSM_TUI_SESSION_NAME) !== undefined;
    const insideTmux = nonEmptyString(defaultPopupEnv.TMUX) !== undefined;
    const tuiCommand =
      options.popupDeps?.tuiCommand ?? defaultPopupTuiCommand(resolvedConfigPath, defaultPopupEnv);
    const uiSessionName =
      options.popupDeps?.uiSessionName ?? popupUiSessionNameFromEnv(defaultPopupEnv);
    const preferRegisteredDevPopup =
      options.popupDeps?.preferRegisteredDevPopup ?? (!hasExplicitPopupUi && insideTmux);
    const popupDeps: PopupCommandDeps = {};
    if (options.popupDeps !== undefined) {
      Object.assign(popupDeps, options.popupDeps);
    }
    if (options.observerDeps !== undefined) {
      popupDeps.observer = options.observerDeps;
    }
    const popupOptions: PopupCommandOptions = loadedCommandOptions(config, resolvedConfigPath);
    popupOptions.tuiCommand = tuiCommand;
    if (popupEnv !== undefined) {
      popupOptions.env = popupEnv;
    }
    popupOptions.preferRegisteredDevPopup = preferRegisteredDevPopup;
    if (uiSessionName !== undefined) {
      popupOptions.uiSessionName = uiSessionName;
    }
    popupOptions.checkoutRoot = repoRootFromCliModule();
    const result = await runPopupCommand(args.slice(1), popupOptions, popupDeps);
    return { code: "code" in result ? result.code : 0, output: result };
  }

  if (command === "tui") {
    const tuiDeps: TuiCommandDeps = {};
    if (options.observerDeps !== undefined) tuiDeps.observer = options.observerDeps;
    if (options.tuiDeps?.runTui !== undefined) tuiDeps.runTui = options.tuiDeps.runTui;
    if (options.tuiDeps?.popupLifecycle !== undefined) {
      tuiDeps.popupLifecycle = options.tuiDeps.popupLifecycle;
    }
    const tuiEnv = options.tuiDeps?.env ?? options.env;
    if (tuiEnv !== undefined) tuiDeps.env = tuiEnv;
    const result = await runTuiCommand(
      commandArgs,
      loadedCommandOptions(config, resolvedConfigPath),
      tuiDeps,
    );
    return { code: result.code, output: result };
  }

  if (command === "snapshot") {
    const result = await runSnapshotCommand(
      commandArgs,
      loadedCommandOptions(config, resolvedConfigPath),
      options.observerDeps,
    );
    return { code: 0, output: result };
  }

  if (command === "reconcile") {
    const result = await runReconcileCommand(
      commandArgs,
      loadedCommandOptions(config, resolvedConfigPath),
      options.observerDeps,
    );
    return { code: 0, output: result };
  }

  if (command === "project") {
    const projectOptions: ProjectCommandOptions = loadedCommandOptions(config, resolvedConfigPath);
    const result = await runProjectCommand(commandArgs, projectOptions, options.observerDeps);
    return { code: projectCommandExitCode(result), output: result };
  }

  if (command === "worktrunk" && commandArgs[0] === "hooks") {
    const result = await runWorktrunkHooksCommand(
      commandArgs.slice(1),
      loadedCommandOptions(config, resolvedConfigPath),
    );
    return { code: hookCommandExitCode(result), output: result };
  }

  const hookAction = commandArgs[0];
  if (
    command === "hooks" &&
    hookAction !== undefined &&
    ["plan", "install", "uninstall", "doctor"].includes(hookAction)
  ) {
    const hookTarget = commandArgs[1];
    const hookArgs = [hookAction, ...commandArgs.slice(2)];
    switch (hookTarget) {
      case "worktrunk": {
        const result = await runWorktrunkHooksCommand(
          hookArgs,
          loadedCommandOptions(config, resolvedConfigPath),
        );
        return { code: hookCommandExitCode(result), output: result };
      }
      case "codex": {
        const codexOptions: CodexHooksCommandOptions = loadedCommandOptions(
          config,
          resolvedConfigPath,
        );
        if (options.env !== undefined) {
          codexOptions.env = options.env;
        }
        const result = await runCodexHooksCommand(hookArgs, codexOptions);
        return { code: hookCommandExitCode(result), output: result };
      }
      case "cursor": {
        const cursorOptions: CursorHooksCommandOptions = loadedCommandOptions(
          config,
          resolvedConfigPath,
        );
        if (options.env !== undefined) {
          cursorOptions.env = options.env;
        }
        const result = await runCursorHooksCommand(hookArgs, cursorOptions);
        return { code: hookCommandExitCode(result), output: result };
      }
      case "opencode": {
        const openCodeOptions: OpenCodeHooksCommandOptions = loadedCommandOptions(config);
        if (options.env !== undefined) {
          openCodeOptions.env = options.env;
        }
        const result = await runOpenCodeHooksCommand(hookArgs, openCodeOptions);
        return { code: hookCommandExitCode(result), output: result };
      }
      case "event": {
        const eventHookOptions: EventHooksCommandOptions = loadedCommandOptions(
          config,
          resolvedConfigPath,
        );
        if (options.env !== undefined) {
          eventHookOptions.env = options.env;
        }
        const result = await runEventHooksCommand(hookArgs, eventHookOptions);
        return { code: hookCommandExitCode(result), output: result };
      }
      default:
        throw new Error(`Unknown hook target: ${hookTarget ?? ""}`);
    }
  }

  throw new Error(`Unknown command: ${command ?? ""}`);
}

type LoadedCommandOptions = {
  config?: NonNullable<Awaited<ReturnType<typeof loadConfig>>["config"]>;
  configPath?: string;
};

function loadedCommandOptions(
  config: Awaited<ReturnType<typeof loadConfig>>["config"] | undefined,
  configPath?: string,
): LoadedCommandOptions {
  const options: LoadedCommandOptions = {};
  if (config !== undefined) {
    options.config = config;
  }
  if (configPath !== undefined) {
    options.configPath = configPath;
  }
  return options;
}

function defaultCommand(env: CliEnv): "popup" | "tui" {
  return env.TMUX === undefined || env.TMUX.length === 0 ? "tui" : "popup";
}

function defaultCommandEnv(options: CliRunOptions): CliEnv {
  return options.env ?? options.popupDeps?.env ?? options.tuiDeps?.env ?? process.env;
}

function hookCommandExitCode(result: object): number {
  return "status" in result && result.status === "warn" ? 1 : 0;
}

function defaultPopupTuiCommand(configPath: string | undefined, env: CliEnv | undefined): string {
  const command = nonEmptyString(env?.WOSM_TUI_COMMAND);
  const parts =
    command === undefined
      ? [shellQuote(process.execPath), shellQuote(fileURLToPath(import.meta.url))]
      : [command];
  if (configPath !== undefined) {
    parts.push("--config", shellQuote(configPath));
  }
  parts.push("tui", "--popup", "--persistent");
  return parts.join(" ");
}

function popupUiSessionNameFromEnv(env: CliEnv | undefined): string | undefined {
  return nonEmptyString(env?.WOSM_TUI_SESSION_NAME);
}

function nonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function repoRootFromCliModule(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../..");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let suppressOutput = false;
  try {
    suppressOutput = shouldSuppressCliProcessOutput(parseGlobalOptions(process.argv.slice(2)).args);
  } catch {
    suppressOutput = false;
  }
  runCli()
    .then((result) => {
      if (!suppressOutput && result.output !== undefined) {
        process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
      }
      if (suppressOutput) {
        if (result.code !== 0 && result.output !== undefined) {
          process.stderr.write(`${JSON.stringify(result.output, null, 2)}\n`);
        }
        process.exit(result.code);
      }
      process.exitCode = result.code;
    })
    .catch((error) => {
      process.stderr.write(`${formatCliError(error)}\n`);
      process.exitCode = 1;
    });
}

export function shouldSuppressCliProcessOutput(invoked: readonly string[]): boolean {
  const command = invoked[0];
  return command === undefined || command === "tui" || command === "popup" || command === "observe";
}

function formatCliError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function parseGlobalOptions(argv: string[]): { args: string[]; configPath?: string } {
  const args: string[] = [];
  let configPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      const value = parseRequiredOptionValue(argv[index + 1], "--config");
      if (value.startsWith("--") || isTopLevelCommand(value)) {
        throw new Error("--config requires a value.");
      }
      configPath = value;
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      args.push(arg);
    }
  }

  return {
    args,
    ...(configPath === undefined ? {} : { configPath }),
  };
}

function commandRequiresConfig(command: string, args: string[]): boolean {
  if (command === "debug") {
    return args[0] === "bundle" || args[0] === "trace";
  }
  return configBackedCommands.includes(command as (typeof configBackedCommands)[number]);
}

function isTopLevelCommand(value: string): boolean {
  return topLevelCommands.includes(value as (typeof topLevelCommands)[number]);
}
