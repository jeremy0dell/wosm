import {
  type CodexHookDoctorResult,
  type CodexHookInstallResult,
  type CodexHookPlan,
  type CodexHookPlanOptions,
  doctorCodexHooks,
  installCodexHooks,
  planCodexHooks,
  uninstallCodexHooks,
} from "@wosm/codex";
import type { WosmConfig } from "@wosm/config";

export type CodexHooksCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
};

export type CodexHooksCommandResult =
  | CodexHookPlan
  | CodexHookInstallResult
  | CodexHookDoctorResult;

export async function runCodexHooksCommand(
  args: string[],
  options: CodexHooksCommandOptions = {},
): Promise<CodexHooksCommandResult> {
  const [action] = args;
  const flags = parseFlags(args.slice(1));
  const hookOptions = buildCodexHookOptions(flags, options);

  if (action === "plan") {
    return planCodexHooks(hookOptions);
  }
  if (action === "install") {
    assertConfirmed(flags.yes, "install");
    return installCodexHooks(hookOptions);
  }
  if (action === "uninstall") {
    assertConfirmed(flags.yes, "uninstall");
    return uninstallCodexHooks(hookOptions);
  }
  if (action === "doctor") {
    const doctorOptions: CodexHookPlanOptions & { enabled?: boolean } = {};
    copyCodexHookOptions(hookOptions, doctorOptions);
    doctorOptions.enabled = options.config?.harness?.codex?.installHooks === true;
    return doctorCodexHooks(doctorOptions);
  }

  throw new Error("Usage: wosm hooks plan|install|uninstall|doctor codex [--yes]");
}

type ParsedCodexHookFlags = {
  yes: boolean;
  codexConfigPath?: string;
  hookScriptPath?: string;
  hookBin?: string;
  wosmBin?: string;
};

function buildCodexHookOptions(
  flags: ParsedCodexHookFlags,
  options: CodexHooksCommandOptions,
): CodexHookPlanOptions {
  const hookOptions: CodexHookPlanOptions = {};
  if (flags.codexConfigPath !== undefined) {
    hookOptions.codexConfigPath = flags.codexConfigPath;
  }
  if (flags.hookScriptPath !== undefined) {
    hookOptions.hookScriptPath = flags.hookScriptPath;
  }
  if (options.config?.observer?.stateDir !== undefined) {
    hookOptions.stateDir = options.config.observer.stateDir;
  }
  if (options.configPath !== undefined) {
    hookOptions.wosmConfigPath = options.configPath;
  }
  if (flags.wosmBin !== undefined) {
    hookOptions.wosmBin = flags.wosmBin;
  }
  if (flags.hookBin !== undefined) {
    hookOptions.hookBin = flags.hookBin;
  }
  if (options.env !== undefined) {
    hookOptions.env = options.env;
  }
  return hookOptions;
}

function copyCodexHookOptions(source: CodexHookPlanOptions, target: CodexHookPlanOptions): void {
  if (source.codexConfigPath !== undefined) {
    target.codexConfigPath = source.codexConfigPath;
  }
  if (source.hookScriptPath !== undefined) {
    target.hookScriptPath = source.hookScriptPath;
  }
  if (source.stateDir !== undefined) {
    target.stateDir = source.stateDir;
  }
  if (source.wosmConfigPath !== undefined) {
    target.wosmConfigPath = source.wosmConfigPath;
  }
  if (source.wosmBin !== undefined) {
    target.wosmBin = source.wosmBin;
  }
  if (source.hookBin !== undefined) {
    target.hookBin = source.hookBin;
  }
  if (source.env !== undefined) {
    target.env = source.env;
  }
}

function parseFlags(args: string[]): ParsedCodexHookFlags {
  const flags: ParsedCodexHookFlags = { yes: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
      continue;
    }
    const value = args[index + 1];
    if (arg === "--codex-config" && value !== undefined) {
      flags.codexConfigPath = value;
      index += 1;
      continue;
    }
    if (arg === "--hook-script" && value !== undefined) {
      flags.hookScriptPath = value;
      index += 1;
      continue;
    }
    if (arg === "--wosm-bin" && value !== undefined) {
      flags.wosmBin = value;
      index += 1;
      continue;
    }
    if (arg === "--hook-bin" && value !== undefined) {
      flags.hookBin = value;
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      throw new Error(`Unknown Codex hook option: ${arg}`);
    }
  }

  return flags;
}

function assertConfirmed(yes: boolean, action: "install" | "uninstall"): void {
  if (!yes) {
    throw new Error(`Refusing to ${action} Codex hooks without --yes.`);
  }
}
