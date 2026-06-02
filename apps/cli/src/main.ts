#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@wosm/config";
import { parseRequiredOptionValue } from "./args.js";
import { runCodexHooksCommand } from "./commands/codexHooks.js";
import { commandCommandExitCode, runCommandCommand } from "./commands/command.js";
import {
  isConfigError,
  runInvalidConfigDebugBundle,
  runInvalidConfigDoctor,
} from "./commands/configDiagnostics.js";
import { runDebugBundleCommand } from "./commands/debugBundle.js";
import { runDebugTraceCommand } from "./commands/debugTrace.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runEventHooksCommand } from "./commands/eventHooks.js";
import { type NotifyCommandDeps, runNotifyCommand } from "./commands/notify.js";
import { observerCommandSummary, runObserverCommand } from "./commands/observer.js";
import { runOpenCodeHooksCommand } from "./commands/opencodeHooks.js";
import { type PopupCommandDeps, runPopupCommand } from "./commands/popup.js";
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
  stdin?: string | undefined;
  env?: CliEnv | undefined;
  observerDeps?: ObserverProcessDeps | undefined;
  popupDeps?: PopupCommandDeps | undefined;
  tuiDeps?: TuiCommandDeps | undefined;
  notifyDeps?: NotifyCommandDeps | undefined;
};

const configBackedCommands = [
  "doctor",
  "hooks",
  "command",
  "observer",
  "popup",
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
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: 0, output: observerCommandSummary(result) };
  }

  if (command === "doctor") {
    const result = await runDoctorCommand(
      commandArgs,
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: result.status === "unavailable" ? 1 : 0, output: result };
  }

  if (command === "debug" && commandArgs[0] === "bundle") {
    const result = await runDebugBundleCommand(
      commandArgs.slice(1),
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: 0, output: result };
  }

  if (command === "debug" && commandArgs[0] === "trace") {
    const result = await runDebugTraceCommand(commandArgs.slice(1), {
      config,
    });
    return { code: result.matched ? 0 : 1, output: result };
  }

  if (command === "notify") {
    const stdin = options.stdin ?? (await readStdinIfAvailable());
    const result = await runNotifyCommand(commandArgs, { stdin }, options.notifyDeps);
    return { code: 0, output: result };
  }

  if (command === "command") {
    const stdin = commandArgs.includes("--stdin")
      ? (options.stdin ?? (await readStdinIfAvailable()))
      : options.stdin;
    const result = await runCommandCommand(
      commandArgs,
      { config, configPath: resolvedConfigPath, stdin },
      options.observerDeps,
    );
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
    const result = await runPopupCommand(
      args.slice(1),
      {
        config,
        configPath: resolvedConfigPath,
        tuiCommand,
        ...(popupEnv === undefined ? {} : { env: popupEnv }),
        preferRegisteredDevPopup,
        ...(uiSessionName === undefined ? {} : { uiSessionName }),
        registeredDevPopupRoot: repoRootFromCliModule(),
      },
      popupDeps,
    );
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
      { config, configPath: resolvedConfigPath },
      tuiDeps,
    );
    return { code: result.code, output: result };
  }

  if (command === "snapshot") {
    const result = await runSnapshotCommand(
      commandArgs,
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: 0, output: result };
  }

  if (command === "reconcile") {
    const result = await runReconcileCommand(
      commandArgs,
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: 0, output: result };
  }

  if (command === "worktrunk" && commandArgs[0] === "hooks") {
    const result = await runWorktrunkHooksCommand(commandArgs.slice(1), {
      config,
      configPath: resolvedConfigPath,
    });
    return { code: "status" in result && result.status === "warn" ? 1 : 0, output: result };
  }

  const hookAction = commandArgs[0];
  if (
    command === "hooks" &&
    hookAction !== undefined &&
    ["plan", "install", "uninstall", "doctor"].includes(hookAction)
  ) {
    const provider = commandArgs[1];
    const result =
      provider === "worktrunk"
        ? await runWorktrunkHooksCommand([hookAction, ...commandArgs.slice(2)], {
            config,
            configPath: resolvedConfigPath,
          })
        : provider === "codex"
          ? await runCodexHooksCommand([hookAction, ...commandArgs.slice(2)], {
              config,
              configPath: resolvedConfigPath,
              env: options.env,
            })
          : provider === "opencode"
            ? await runOpenCodeHooksCommand([hookAction, ...commandArgs.slice(2)], {
                config,
                env: options.env,
              })
            : provider === "event"
              ? await runEventHooksCommand([hookAction, ...commandArgs.slice(2)], {
                  config,
                  configPath: resolvedConfigPath,
                  env: options.env,
                })
              : undefined;
    if (result === undefined) {
      throw new Error(`Unknown hook provider: ${provider ?? ""}`);
    }
    return { code: "status" in result && result.status === "warn" ? 1 : 0, output: result };
  }

  throw new Error(`Unknown command: ${command ?? ""}`);
}

function defaultCommand(env: CliEnv): "popup" | "tui" {
  return env.TMUX === undefined || env.TMUX.length === 0 ? "tui" : "popup";
}

function defaultCommandEnv(options: CliRunOptions): CliEnv {
  return options.env ?? options.popupDeps?.env ?? options.tuiDeps?.env ?? process.env;
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
      process.exit(result.code);
    })
    .catch((error) => {
      process.stderr.write(`${formatCliError(error)}\n`);
      process.exitCode = 1;
    });
}

export function shouldSuppressCliProcessOutput(invoked: readonly string[]): boolean {
  const command = invoked[0];
  return command === undefined || command === "tui" || command === "popup";
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
