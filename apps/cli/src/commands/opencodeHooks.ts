import { resolveObserverPaths, type WosmConfig } from "@wosm/config";
import {
  doctorOpenCodePlugin,
  installOpenCodePlugin,
  type OpenCodePluginDoctorResult,
  type OpenCodePluginInstallResult,
  type OpenCodePluginPlan,
  type OpenCodePluginPlanOptions,
  planOpenCodePlugin,
  uninstallOpenCodePlugin,
} from "@wosm/opencode";

export type OpenCodeHooksCommandOptions = {
  config?: WosmConfig | undefined;
  env?: Record<string, string | undefined> | undefined;
};

export type OpenCodeHooksCommandResult =
  | OpenCodePluginPlan
  | OpenCodePluginInstallResult
  | OpenCodePluginDoctorResult;

export async function runOpenCodeHooksCommand(
  args: string[],
  options: OpenCodeHooksCommandOptions = {},
): Promise<OpenCodeHooksCommandResult> {
  const [action] = args;
  const flags = parseFlags(args.slice(1));
  const pluginOptions = buildOpenCodePluginOptions(flags, options);

  if (action === "plan") {
    return planOpenCodePlugin(pluginOptions);
  }
  if (action === "install") {
    assertConfirmed(flags.yes, "install");
    return installOpenCodePlugin(pluginOptions);
  }
  if (action === "uninstall") {
    assertConfirmed(flags.yes, "uninstall");
    return uninstallOpenCodePlugin(pluginOptions);
  }
  if (action === "doctor") {
    const doctorOptions: OpenCodePluginPlanOptions & { enabled?: boolean } = {};
    copyOpenCodePluginOptions(pluginOptions, doctorOptions);
    doctorOptions.enabled = options.config?.harness?.opencode?.installHooks === true;
    return doctorOpenCodePlugin(doctorOptions);
  }

  throw new Error("Usage: wosm hooks plan|install|uninstall|doctor opencode [--yes]");
}

type ParsedOpenCodeHookFlags = {
  yes: boolean;
  opencodeConfigDir?: string;
  pluginPath?: string;
};

function buildOpenCodePluginOptions(
  flags: ParsedOpenCodeHookFlags,
  options: OpenCodeHooksCommandOptions,
): OpenCodePluginPlanOptions {
  const pluginOptions: OpenCodePluginPlanOptions = {};
  if (flags.opencodeConfigDir !== undefined) {
    pluginOptions.opencodeConfigDir = flags.opencodeConfigDir;
  }
  if (flags.pluginPath !== undefined) {
    pluginOptions.pluginPath = flags.pluginPath;
  }
  if (options.config !== undefined) {
    const paths = resolveObserverPaths(options.config);
    pluginOptions.observerSocketPath = paths.socketPath;
    pluginOptions.stateDir = paths.stateDir;
    pluginOptions.hookSpoolDir = paths.hookSpoolDir;
  }
  if (options.env !== undefined) {
    pluginOptions.env = options.env;
  }
  return pluginOptions;
}

function copyOpenCodePluginOptions(
  source: OpenCodePluginPlanOptions,
  target: OpenCodePluginPlanOptions,
): void {
  if (source.opencodeConfigDir !== undefined) {
    target.opencodeConfigDir = source.opencodeConfigDir;
  }
  if (source.pluginPath !== undefined) {
    target.pluginPath = source.pluginPath;
  }
  if (source.observerSocketPath !== undefined) {
    target.observerSocketPath = source.observerSocketPath;
  }
  if (source.stateDir !== undefined) {
    target.stateDir = source.stateDir;
  }
  if (source.hookSpoolDir !== undefined) {
    target.hookSpoolDir = source.hookSpoolDir;
  }
  if (source.env !== undefined) {
    target.env = source.env;
  }
}

function parseFlags(args: string[]): ParsedOpenCodeHookFlags {
  const flags: ParsedOpenCodeHookFlags = { yes: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
      continue;
    }
    const value = args[index + 1];
    if (arg === "--opencode-config-dir" && value !== undefined) {
      flags.opencodeConfigDir = value;
      index += 1;
      continue;
    }
    if (arg === "--plugin-path" && value !== undefined) {
      flags.pluginPath = value;
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      throw new Error(`Unknown OpenCode hook option: ${arg}`);
    }
  }

  return flags;
}

function assertConfirmed(yes: boolean, action: "install" | "uninstall"): void {
  if (!yes) {
    throw new Error(`Refusing to ${action} OpenCode hooks without --yes.`);
  }
}
