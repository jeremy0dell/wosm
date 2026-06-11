import {
  type ClaudeHookDoctorResult,
  type ClaudeHookInstallResult,
  type ClaudeHookPlan,
  type ClaudeHookPlanOptions,
  doctorClaudeHooks,
  installClaudeHooks,
  planClaudeHooks,
  uninstallClaudeHooks,
} from "@wosm/claude";
import { resolveObserverPaths, type WosmConfig } from "@wosm/config";
import type { CliEnv } from "../env.js";

export type ClaudeHooksCommandOptions = {
  config?: WosmConfig;
  configPath?: string;
  env?: CliEnv;
};

export type ClaudeHooksCommandResult =
  | ClaudeHookPlan
  | ClaudeHookInstallResult
  | ClaudeHookDoctorResult;

type ParsedClaudeHookFlags = {
  yes: boolean;
  claudeSettingsPath?: string;
  hookScriptPath?: string;
  hookBin?: string;
};

function buildClaudeHookOptions(
  flags: ParsedClaudeHookFlags,
  options: ClaudeHooksCommandOptions,
): ClaudeHookPlanOptions {
  const hookOptions: ClaudeHookPlanOptions = {};
  if (flags.claudeSettingsPath !== undefined) {
    hookOptions.claudeSettingsPath = flags.claudeSettingsPath;
  }
  if (flags.hookScriptPath !== undefined) {
    hookOptions.hookScriptPath = flags.hookScriptPath;
  }
  if (options.config?.observer?.stateDir !== undefined) {
    hookOptions.stateDir = options.config.observer.stateDir;
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

function parseFlags(args: string[]): ParsedClaudeHookFlags {
  const flags: ParsedClaudeHookFlags = { yes: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
      continue;
    }
    const value = args[index + 1];
    if (arg === "--claude-settings" && value !== undefined) {
      flags.claudeSettingsPath = value;
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
      throw new Error(`Unknown Claude hook option: ${arg}`);
    }
  }

  return flags;
}

function assertConfirmed(yes: boolean, action: "install" | "uninstall"): void {
  if (!yes) {
    throw new Error(`Refusing to ${action} Claude hooks without --yes.`);
  }
}

export async function runClaudeHooksCommand(
  args: string[],
  options: ClaudeHooksCommandOptions = {},
): Promise<ClaudeHooksCommandResult> {
  const [action] = args;
  const flags = parseFlags(args.slice(1));
  const hookOptions = buildClaudeHookOptions(flags, options);

  if (action === "plan") {
    return planClaudeHooks(hookOptions);
  }
  if (action === "install") {
    assertConfirmed(flags.yes, "install");
    return installClaudeHooks(hookOptions);
  }
  if (action === "uninstall") {
    assertConfirmed(flags.yes, "uninstall");
    return uninstallClaudeHooks(hookOptions);
  }
  if (action === "doctor") {
    const doctorOptions: ClaudeHookPlanOptions & { enabled?: boolean } = {
      ...hookOptions,
      enabled: options.config?.harness?.claude?.installHooks === true,
    };
    return doctorClaudeHooks(doctorOptions);
  }

  throw new Error("Usage: wosm hooks plan|install|uninstall|doctor claude [--yes]");
}
