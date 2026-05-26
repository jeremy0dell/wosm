import {
  documentContainsCommand,
  generatedWosmHookEvents,
  installCodexHookCommands,
  missingCodexHookEvents,
  parseTomlDocument,
  removeGeneratedCodexHookCommands,
  stringifyTomlDocument,
} from "./hookConfigEditor.js";
import { CODEX_WOSM_PROFILE_NAME, type CodexHookEventName } from "./hookConstants.js";
import {
  backupIfPresent,
  readOptionalFile,
  removeHookScriptIfPresent,
  writeHookConfig,
  writeHookScript,
} from "./hookFiles.js";
import {
  resolveCodexBaseConfigPath,
  resolveCodexConfigPath,
  resolveCodexHookScriptPath,
} from "./hookPaths.js";
import {
  type CodexHookScriptOptions,
  expectedCodexHookCommands,
  expectedCodexHookScript,
} from "./hookScript.js";

export { CODEX_HOOK_EVENT_NAMES, type CodexHookEventName } from "./hookConstants.js";
export { CodexHookSetupError, type CodexHookSetupErrorCode } from "./hookErrors.js";
export {
  resolveCodexBaseConfigPath,
  resolveCodexConfigPath,
  resolveCodexHookScriptPath,
} from "./hookPaths.js";
export { expectedCodexHookCommands, expectedCodexHookScript } from "./hookScript.js";

export type CodexHookPlanOptions = {
  codexConfigPath?: string;
  hookScriptPath?: string;
  stateDir?: string;
  wosmConfigPath?: string;
  hookBin?: string;
  wosmBin?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export type CodexGeneratedGlobalHookCleanup = {
  configPath: string;
  changed: boolean;
  stale: CodexHookEventName[];
  before: string;
  after: string;
  skipped?: boolean;
  reason?: "same-as-profile";
};

export type CodexLegacyGlobalCleanupStatus = CodexGeneratedGlobalHookCleanup;

export type CodexHookPlan = {
  provider: "codex";
  configPath: string;
  profileName: typeof CODEX_WOSM_PROFILE_NAME;
  profileConfigPath: string;
  baseConfigPath: string;
  hookScriptPath: string;
  commands: Record<CodexHookEventName, string>;
  missing: CodexHookEventName[];
  changed: boolean;
  configChanged: boolean;
  legacyGlobalChanged: boolean;
  scriptChanged: boolean;
  legacyGlobalCleanup: CodexGeneratedGlobalHookCleanup;
  before: string;
  after: string;
};

export type CodexHookInstallResult = CodexHookPlan & {
  installed: boolean;
  backupPath?: string;
  profileBackupPath?: string;
  baseBackupPath?: string;
  backupPaths?: string[];
  scriptRemoved?: boolean;
};

export type CodexHookDoctorResult = {
  provider: "codex";
  configPath: string;
  profileName: typeof CODEX_WOSM_PROFILE_NAME;
  profileConfigPath: string;
  baseConfigPath: string;
  hookScriptPath: string;
  status: "ok" | "warn";
  installed: boolean;
  missing: CodexHookEventName[];
  commands: Record<CodexHookEventName, string>;
  legacyGlobalCleanup: CodexGeneratedGlobalHookCleanup;
  message: string;
};

export async function planCodexHooks(options: CodexHookPlanOptions = {}): Promise<CodexHookPlan> {
  const configPath = resolveCodexConfigPath(options);
  const baseConfigPath = resolveCodexBaseConfigPath(options);
  const hookScriptPath = resolveCodexHookScriptPath(options);
  const before = await readOptionalFile(configPath);
  const document = parseTomlDocument(before);
  const commands = expectedCodexHookCommands({ hookScriptPath });
  const afterDocument = installCodexHookCommands(document, commands);
  const after = stringifyTomlDocument(afterDocument);
  const script = expectedCodexHookScript(scriptOptions(hookScriptPath, options));
  const scriptBefore = await readOptionalFile(hookScriptPath);
  const configChanged = before.trim() !== after.trim();
  const scriptChanged = scriptBefore !== script;
  const generatedGlobalCleanup = await buildGeneratedGlobalHookCleanup({
    baseConfigPath,
    profileConfigPath: configPath,
    commands,
  });

  return {
    provider: "codex",
    configPath,
    profileName: CODEX_WOSM_PROFILE_NAME,
    profileConfigPath: configPath,
    baseConfigPath,
    hookScriptPath,
    commands,
    missing: missingCodexHookEvents(document, commands),
    changed: configChanged || scriptChanged || generatedGlobalCleanup.changed,
    configChanged,
    legacyGlobalChanged: generatedGlobalCleanup.changed,
    scriptChanged,
    legacyGlobalCleanup: generatedGlobalCleanup,
    before,
    after,
  };
}

export async function installCodexHooks(
  options: CodexHookPlanOptions = {},
): Promise<CodexHookInstallResult> {
  const plan = await planCodexHooks(options);
  let profileBackupPath: string | undefined;
  let baseBackupPath: string | undefined;

  if (plan.configChanged) {
    profileBackupPath = await backupIfPresent(plan.configPath);
    await writeHookConfig(plan.configPath, plan.after);
  }
  if (plan.legacyGlobalCleanup.changed) {
    baseBackupPath = await backupIfPresent(plan.baseConfigPath);
    await writeHookConfig(plan.baseConfigPath, plan.legacyGlobalCleanup.after);
  }
  if (plan.scriptChanged) {
    await writeHookScript(
      plan.hookScriptPath,
      expectedCodexHookScript(scriptOptions(plan.hookScriptPath, options)),
    );
  }

  const result = installResultFromPlan(plan, true);
  assignBackupPaths(result, { profileBackupPath, baseBackupPath });
  return result;
}

export async function uninstallCodexHooks(
  options: CodexHookPlanOptions = {},
): Promise<CodexHookInstallResult> {
  const configPath = resolveCodexConfigPath(options);
  const baseConfigPath = resolveCodexBaseConfigPath(options);
  const hookScriptPath = resolveCodexHookScriptPath(options);
  const before = await readOptionalFile(configPath);
  const document = parseTomlDocument(before);
  const commands = expectedCodexHookCommands({ hookScriptPath });
  const afterDocument = removeGeneratedCodexHookCommands(document, commands);
  const after = stringifyTomlDocument(afterDocument);
  const generatedGlobalCleanup = await buildGeneratedGlobalHookCleanup({
    baseConfigPath,
    profileConfigPath: configPath,
    commands,
  });
  const configChanged = before.trim() !== after.trim();
  let profileBackupPath: string | undefined;
  let baseBackupPath: string | undefined;

  if (configChanged) {
    profileBackupPath = await backupIfPresent(configPath);
    await writeHookConfig(configPath, after);
  }
  if (generatedGlobalCleanup.changed) {
    baseBackupPath = await backupIfPresent(baseConfigPath);
    await writeHookConfig(baseConfigPath, generatedGlobalCleanup.after);
  }

  const scriptStillNeeded = documentContainsCommand(afterDocument, hookScriptPath);
  const scriptRemoved = scriptStillNeeded ? false : await removeHookScriptIfPresent(hookScriptPath);
  const result: CodexHookInstallResult = {
    provider: "codex",
    configPath,
    profileName: CODEX_WOSM_PROFILE_NAME,
    profileConfigPath: configPath,
    baseConfigPath,
    hookScriptPath,
    commands,
    missing: missingCodexHookEvents(afterDocument, commands),
    changed: configChanged || generatedGlobalCleanup.changed || scriptRemoved,
    configChanged,
    legacyGlobalChanged: generatedGlobalCleanup.changed,
    scriptChanged: scriptRemoved,
    legacyGlobalCleanup: generatedGlobalCleanup,
    before,
    after,
    installed: false,
    scriptRemoved,
  };
  assignBackupPaths(result, { profileBackupPath, baseBackupPath });
  return result;
}

export async function doctorCodexHooks(
  options: CodexHookPlanOptions & { enabled?: boolean } = {},
): Promise<CodexHookDoctorResult> {
  const plan = await planCodexHooks(options);
  const generatedGlobalInstalled = plan.legacyGlobalCleanup.stale.length > 0;
  if (options.enabled === false) {
    return {
      provider: "codex",
      configPath: plan.configPath,
      profileName: plan.profileName,
      profileConfigPath: plan.profileConfigPath,
      baseConfigPath: plan.baseConfigPath,
      hookScriptPath: plan.hookScriptPath,
      status: generatedGlobalInstalled ? "warn" : "ok",
      installed: false,
      missing: plan.missing,
      commands: plan.commands,
      legacyGlobalCleanup: plan.legacyGlobalCleanup,
      message: generatedGlobalInstalled
        ? "Codex hooks are not requested in wosm config, but generated global Codex hooks remain in the base config."
        : "Codex hooks are not requested in wosm config.",
    };
  }

  const installed = plan.missing.length === 0 && !plan.scriptChanged;
  return {
    provider: "codex",
    configPath: plan.configPath,
    profileName: plan.profileName,
    profileConfigPath: plan.profileConfigPath,
    baseConfigPath: plan.baseConfigPath,
    hookScriptPath: plan.hookScriptPath,
    status: installed && !generatedGlobalInstalled ? "ok" : "warn",
    installed,
    missing: plan.missing,
    commands: plan.commands,
    legacyGlobalCleanup: plan.legacyGlobalCleanup,
    message: doctorMessage({ installed, generatedGlobalInstalled, plan }),
  };
}

function scriptOptions(
  hookScriptPath: string,
  options: Pick<CodexHookPlanOptions, "wosmConfigPath" | "hookBin" | "wosmBin">,
): CodexHookScriptOptions {
  const input: CodexHookScriptOptions = { hookScriptPath };
  if (options.wosmConfigPath !== undefined) {
    input.wosmConfigPath = options.wosmConfigPath;
  }
  if (options.hookBin !== undefined) {
    input.hookBin = options.hookBin;
  }
  if (options.wosmBin !== undefined) {
    input.wosmBin = options.wosmBin;
  }
  return input;
}

function installResultFromPlan(plan: CodexHookPlan, installed: boolean): CodexHookInstallResult {
  return {
    provider: plan.provider,
    configPath: plan.configPath,
    profileName: plan.profileName,
    profileConfigPath: plan.profileConfigPath,
    baseConfigPath: plan.baseConfigPath,
    hookScriptPath: plan.hookScriptPath,
    commands: plan.commands,
    missing: plan.missing,
    changed: plan.changed,
    configChanged: plan.configChanged,
    legacyGlobalChanged: plan.legacyGlobalChanged,
    scriptChanged: plan.scriptChanged,
    legacyGlobalCleanup: plan.legacyGlobalCleanup,
    before: plan.before,
    after: plan.after,
    installed,
  };
}

async function buildGeneratedGlobalHookCleanup(input: {
  baseConfigPath: string;
  profileConfigPath: string;
  commands: Record<CodexHookEventName, string>;
}): Promise<CodexGeneratedGlobalHookCleanup> {
  if (input.baseConfigPath === input.profileConfigPath) {
    return {
      configPath: input.baseConfigPath,
      changed: false,
      stale: [],
      before: "",
      after: "",
      skipped: true,
      reason: "same-as-profile",
    };
  }

  const before = await readOptionalFile(input.baseConfigPath);
  const document = parseTomlDocument(before);
  const stale = generatedWosmHookEvents(document, input.commands);
  const afterDocument = removeGeneratedCodexHookCommands(document, input.commands);
  const after = stringifyTomlDocument(afterDocument);
  return {
    configPath: input.baseConfigPath,
    changed: before.trim() !== after.trim(),
    stale,
    before,
    after,
  };
}

function missingDescription(plan: CodexHookPlan): string {
  const missing = plan.missing.length === 0 ? "none" : plan.missing.join(", ");
  return plan.scriptChanged ? `${missing}; script is missing or stale` : missing;
}

function doctorMessage(input: {
  installed: boolean;
  generatedGlobalInstalled: boolean;
  plan: CodexHookPlan;
}): string {
  if (input.installed && input.generatedGlobalInstalled) {
    return "Codex hooks are installed in the wosm profile, but generated global Codex hooks remain in the base config.";
  }
  if (input.installed) {
    return "Codex hooks are installed in the wosm profile.";
  }

  const missing = missingDescription(input.plan);
  if (input.generatedGlobalInstalled) {
    return `Codex hooks are missing or stale in the wosm profile: ${missing}; generated global hooks remain in the base config.`;
  }
  return `Codex hooks are missing or stale in the wosm profile: ${missing}.`;
}

function assignBackupPaths(
  result: CodexHookInstallResult,
  paths: { profileBackupPath: string | undefined; baseBackupPath: string | undefined },
): void {
  const backupPaths: string[] = [];
  if (paths.profileBackupPath !== undefined) {
    result.backupPath = paths.profileBackupPath;
    result.profileBackupPath = paths.profileBackupPath;
    backupPaths.push(paths.profileBackupPath);
  }
  if (paths.baseBackupPath !== undefined) {
    result.baseBackupPath = paths.baseBackupPath;
    backupPaths.push(paths.baseBackupPath);
  }
  if (backupPaths.length > 0) {
    result.backupPaths = backupPaths;
  }
}
