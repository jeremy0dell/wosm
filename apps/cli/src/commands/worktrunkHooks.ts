import { resolveObserverPaths, type WosmConfig } from "@wosm/config";
import {
  doctorWorktrunkHooks,
  installWorktrunkHooks,
  planWorktrunkHooks,
  uninstallWorktrunkHooks,
  type WorktrunkHookDoctorResult,
  type WorktrunkHookInstallResult,
  type WorktrunkHookPlan,
  type WorktrunkHookPlanOptions,
} from "@wosm/worktrunk";

export type WorktrunkHooksCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
};

export type WorktrunkHooksCommandResult =
  | WorktrunkHookPlan
  | WorktrunkHookInstallResult
  | WorktrunkHookDoctorResult;

type ParsedWorktrunkHookFlags = {
  yes: boolean;
  worktrunkConfigPath?: string;
  hookBin?: string;
};

export async function runWorktrunkHooksCommand(
  args: string[],
  options: WorktrunkHooksCommandOptions = {},
): Promise<WorktrunkHooksCommandResult> {
  const [action] = args;
  const flags = parseFlags(args.slice(1));
  const worktrunkConfigPath =
    flags.worktrunkConfigPath ?? options.config?.worktree?.worktrunk?.configPath;
  const observerPaths =
    options.config === undefined ? undefined : resolveObserverPaths(options.config);
  const hookOptions: WorktrunkHookPlanOptions = {
    ...(worktrunkConfigPath === undefined ? {} : { worktrunkConfigPath }),
    ...(options.configPath === undefined ? {} : { wosmConfigPath: options.configPath }),
    ...(observerPaths === undefined ? {} : { observerSocketPath: observerPaths.socketPath }),
    ...(observerPaths === undefined ? {} : { stateDir: observerPaths.stateDir }),
    ...(observerPaths === undefined ? {} : { hookSpoolDir: observerPaths.hookSpoolDir }),
    ...(options.config?.observer?.autoStartFromHooks === false
      ? { autoStartFromHooks: false }
      : {}),
    ...(flags.hookBin === undefined ? {} : { hookBin: flags.hookBin }),
  };

  if (action === "plan") {
    return planWorktrunkHooks(hookOptions);
  }
  if (action === "install") {
    assertConfirmed(flags.yes, "install");
    return installWorktrunkHooks(hookOptions);
  }
  if (action === "uninstall") {
    assertConfirmed(flags.yes, "uninstall");
    return uninstallWorktrunkHooks(hookOptions);
  }
  if (action === "doctor") {
    return doctorWorktrunkHooks({
      ...hookOptions,
      enabled: options.config?.worktree?.worktrunk?.useLifecycleHooks !== false,
    });
  }

  throw new Error("Usage: wosm worktrunk hooks plan|install|uninstall|doctor [--yes]");
}

function parseFlags(args: string[]): ParsedWorktrunkHookFlags {
  const flags: ParsedWorktrunkHookFlags = { yes: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
      continue;
    }
    const value = args[index + 1];
    if (arg === "--worktrunk-config" && value !== undefined) {
      flags.worktrunkConfigPath = value;
      index += 1;
      continue;
    }
    if (arg === "--hook-bin" && value !== undefined) {
      flags.hookBin = value;
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      throw new Error(`Unknown Worktrunk hook option: ${arg}`);
    }
  }

  return flags;
}

function assertConfirmed(yes: boolean, action: "install" | "uninstall"): void {
  if (!yes) {
    throw new Error(`Refusing to ${action} Worktrunk hooks without --yes.`);
  }
}
