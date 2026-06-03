import { resolveObserverPaths, type WosmConfig } from "@wosm/config";
import {
  type CursorHookDoctorResult,
  type CursorHookInstallResult,
  type CursorHookPlan,
  type CursorHookPlanOptions,
  doctorCursorHooks,
  installCursorHooks,
  planCursorHooks,
  uninstallCursorHooks,
} from "@wosm/cursor";
import type { CliEnv } from "../env.js";

export type CursorHooksCommandOptions = {
  config?: WosmConfig;
  configPath?: string;
  env?: CliEnv;
};

export type CursorHooksCommandResult =
  | CursorHookPlan
  | CursorHookInstallResult
  | CursorHookDoctorResult;

type ParsedCursorHookFlags = {
  yes: boolean;
  cursorHooksPath?: string;
  hookScriptPath?: string;
  hookBin?: string;
};

function buildCursorHookOptions(
  flags: ParsedCursorHookFlags,
  options: CursorHooksCommandOptions,
): CursorHookPlanOptions {
  const hookOptions: CursorHookPlanOptions = {};
  if (flags.cursorHooksPath !== undefined) {
    hookOptions.cursorHooksPath = flags.cursorHooksPath;
  }
  if (flags.hookScriptPath !== undefined) {
    hookOptions.hookScriptPath = flags.hookScriptPath;
  }
  if (options.config !== undefined) {
    const paths = resolveObserverPaths(options.config);
    hookOptions.observerSocketPath = paths.socketPath;
    hookOptions.stateDir = paths.stateDir;
    hookOptions.hookSpoolDir = paths.hookSpoolDir;
    hookOptions.autoStartFromHooks = options.config.observer?.autoStartFromHooks !== false;
  }
  if (options.configPath !== undefined) {
    hookOptions.wosmConfigPath = options.configPath;
  }
  if (flags.hookBin !== undefined) {
    hookOptions.hookBin = flags.hookBin;
  }
  if (options.env !== undefined) {
    hookOptions.env = options.env;
  }
  return hookOptions;
}

function copyCursorHookOptions(source: CursorHookPlanOptions, target: CursorHookPlanOptions): void {
  if (source.cursorHooksPath !== undefined) {
    target.cursorHooksPath = source.cursorHooksPath;
  }
  if (source.hookScriptPath !== undefined) {
    target.hookScriptPath = source.hookScriptPath;
  }
  if (source.stateDir !== undefined) {
    target.stateDir = source.stateDir;
  }
  if (source.observerSocketPath !== undefined) {
    target.observerSocketPath = source.observerSocketPath;
  }
  if (source.hookSpoolDir !== undefined) {
    target.hookSpoolDir = source.hookSpoolDir;
  }
  if (source.autoStartFromHooks !== undefined) {
    target.autoStartFromHooks = source.autoStartFromHooks;
  }
  if (source.wosmConfigPath !== undefined) {
    target.wosmConfigPath = source.wosmConfigPath;
  }
  if (source.hookBin !== undefined) {
    target.hookBin = source.hookBin;
  }
  if (source.env !== undefined) {
    target.env = source.env;
  }
}

function parseFlags(args: string[]): ParsedCursorHookFlags {
  const flags: ParsedCursorHookFlags = { yes: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
      continue;
    }
    const value = args[index + 1];
    if (arg === "--cursor-hooks" && value !== undefined) {
      flags.cursorHooksPath = value;
      index += 1;
      continue;
    }
    if (arg === "--hook-script" && value !== undefined) {
      flags.hookScriptPath = value;
      index += 1;
      continue;
    }
    if (arg === "--hook-bin" && value !== undefined) {
      flags.hookBin = value;
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      throw new Error(`Unknown Cursor hook option: ${arg}`);
    }
  }

  return flags;
}

function assertConfirmed(yes: boolean, action: "install" | "uninstall"): void {
  if (!yes) {
    throw new Error(`Refusing to ${action} Cursor hooks without --yes.`);
  }
}

export async function runCursorHooksCommand(
  args: string[],
  options: CursorHooksCommandOptions = {},
): Promise<CursorHooksCommandResult> {
  const [action] = args;
  const flags = parseFlags(args.slice(1));
  const hookOptions = buildCursorHookOptions(flags, options);

  if (action === "plan") {
    return planCursorHooks(hookOptions);
  }
  if (action === "install") {
    assertConfirmed(flags.yes, "install");
    return installCursorHooks(hookOptions);
  }
  if (action === "uninstall") {
    assertConfirmed(flags.yes, "uninstall");
    return uninstallCursorHooks(hookOptions);
  }
  if (action === "doctor") {
    const doctorOptions: CursorHookPlanOptions & { enabled?: boolean } = {};
    copyCursorHookOptions(hookOptions, doctorOptions);
    doctorOptions.enabled = options.config?.harness?.cursor?.installHooks === true;
    return doctorCursorHooks(doctorOptions);
  }

  throw new Error("Usage: wosm hooks plan|install|uninstall|doctor cursor [--yes]");
}
