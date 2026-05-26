import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse, stringify } from "smol-toml";

const CODEX_WOSM_PROFILE_NAME = "wosm";
const CODEX_WOSM_PROFILE_CONFIG_FILE = "wosm.config.toml";
const CODEX_BASE_CONFIG_FILE = "config.toml";
const GENERATED_HOOK_STATUS_MESSAGE = "Notify wosm";
const GENERATED_HOOK_SCRIPT_NAME = "wosm-codex-hook.sh";

export const CODEX_HOOK_EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;

export type CodexHookEventName = (typeof CODEX_HOOK_EVENT_NAMES)[number];

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

export type CodexLegacyGlobalCleanupStatus = {
  configPath: string;
  changed: boolean;
  stale: CodexHookEventName[];
  before: string;
  after: string;
  skipped?: boolean;
  reason?: "same-as-profile";
};

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
  legacyGlobalCleanup: CodexLegacyGlobalCleanupStatus;
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
  legacyGlobalCleanup: CodexLegacyGlobalCleanupStatus;
  message: string;
};

export type CodexHookSetupErrorCode =
  | "CODEX_HOOK_CONFIG_UNREADABLE"
  | "CODEX_HOOK_INVALID_TOML"
  | "CODEX_HOOK_WRITE_FAILED";

export class CodexHookSetupError extends Error {
  readonly tag = "CodexHookSetupError";
  readonly code: CodexHookSetupErrorCode;
  readonly provider = "codex";

  constructor(code: CodexHookSetupErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    Object.defineProperty(this, "name", {
      value: this.tag,
      enumerable: false,
      configurable: true,
    });
    this.code = code;
  }
}

export async function planCodexHooks(options: CodexHookPlanOptions = {}): Promise<CodexHookPlan> {
  const configPath = resolveCodexConfigPath(options);
  const baseConfigPath = resolveCodexBaseConfigPath(options);
  const hookScriptPath = resolveCodexHookScriptPath(options);
  const before = await readOptionalFile(configPath);
  const document = parseTomlDocument(before);
  const script = expectedCodexHookScript(scriptOptions(hookScriptPath, options));
  const commands = expectedCodexHookCommands({ hookScriptPath });
  const missing = CODEX_HOOK_EVENT_NAMES.filter(
    (eventName) => !hookContainsCommand(document, eventName, commands[eventName]),
  );
  const afterDocument = installCommands(document, commands);
  const after = stringifyTomlDocument(afterDocument);
  const scriptBefore = await readOptionalFile(hookScriptPath);
  const configChanged = before.trim() !== after.trim();
  const scriptChanged = scriptBefore !== script;
  const legacyGlobalCleanup = await planLegacyGlobalCleanup({
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
    missing,
    changed: configChanged || scriptChanged || legacyGlobalCleanup.changed,
    configChanged,
    legacyGlobalChanged: legacyGlobalCleanup.changed,
    scriptChanged,
    legacyGlobalCleanup,
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

function scriptOptions(
  hookScriptPath: string,
  options: Pick<CodexHookPlanOptions, "wosmConfigPath" | "hookBin" | "wosmBin">,
): Parameters<typeof expectedCodexHookScript>[0] {
  const input: Parameters<typeof expectedCodexHookScript>[0] = { hookScriptPath };
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

export async function uninstallCodexHooks(
  options: CodexHookPlanOptions = {},
): Promise<CodexHookInstallResult> {
  const configPath = resolveCodexConfigPath(options);
  const baseConfigPath = resolveCodexBaseConfigPath(options);
  const hookScriptPath = resolveCodexHookScriptPath(options);
  const before = await readOptionalFile(configPath);
  const document = parseTomlDocument(before);
  const commands = expectedCodexHookCommands({ hookScriptPath });
  const afterDocument = uninstallCommands(document, commands);
  const after = stringifyTomlDocument(afterDocument);
  const missing = CODEX_HOOK_EVENT_NAMES.filter(
    (eventName) => !hookContainsCommand(afterDocument, eventName, commands[eventName]),
  );
  const configChanged = before.trim() !== after.trim();
  const legacyGlobalCleanup = await planLegacyGlobalCleanup({
    baseConfigPath,
    profileConfigPath: configPath,
    commands,
  });
  let profileBackupPath: string | undefined;
  let baseBackupPath: string | undefined;
  if (configChanged) {
    profileBackupPath = await backupIfPresent(configPath);
    await writeHookConfig(configPath, after);
  }
  if (legacyGlobalCleanup.changed) {
    baseBackupPath = await backupIfPresent(baseConfigPath);
    await writeHookConfig(baseConfigPath, legacyGlobalCleanup.after);
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
    missing,
    changed: configChanged || legacyGlobalCleanup.changed || scriptRemoved,
    configChanged,
    legacyGlobalChanged: legacyGlobalCleanup.changed,
    scriptChanged: scriptRemoved,
    legacyGlobalCleanup,
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
  const legacyGlobalInstalled = plan.legacyGlobalCleanup.stale.length > 0;
  if (options.enabled === false) {
    return {
      provider: "codex",
      configPath: plan.configPath,
      profileName: plan.profileName,
      profileConfigPath: plan.profileConfigPath,
      baseConfigPath: plan.baseConfigPath,
      hookScriptPath: plan.hookScriptPath,
      status: legacyGlobalInstalled ? "warn" : "ok",
      installed: false,
      missing: plan.missing,
      commands: plan.commands,
      legacyGlobalCleanup: plan.legacyGlobalCleanup,
      message: legacyGlobalInstalled
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
    status: installed && !legacyGlobalInstalled ? "ok" : "warn",
    installed,
    missing: plan.missing,
    commands: plan.commands,
    legacyGlobalCleanup: plan.legacyGlobalCleanup,
    message: doctorMessage({ installed, legacyGlobalInstalled, plan }),
  };
}

export function resolveCodexConfigPath(options: CodexHookPlanOptions = {}): string {
  if (options.codexConfigPath !== undefined) {
    return resolvePath(options.codexConfigPath, options.homeDir ?? homedir());
  }

  return join(resolveCodexHome(options), CODEX_WOSM_PROFILE_CONFIG_FILE);
}

export function resolveCodexBaseConfigPath(options: CodexHookPlanOptions = {}): string {
  return join(resolveCodexHome(options), CODEX_BASE_CONFIG_FILE);
}

export function resolveCodexHookScriptPath(options: CodexHookPlanOptions = {}): string {
  if (options.hookScriptPath !== undefined) {
    return resolvePath(options.hookScriptPath, options.homeDir ?? homedir());
  }
  const stateDir = options.stateDir ?? defaultStateDir(options);
  return resolvePath(join(stateDir, "hooks", "wosm-codex-hook.sh"), options.homeDir ?? homedir());
}

export function expectedCodexHookCommands(input: {
  hookScriptPath: string;
}): Record<CodexHookEventName, string> {
  return Object.fromEntries(
    CODEX_HOOK_EVENT_NAMES.map((eventName) => [eventName, input.hookScriptPath]),
  ) as Record<CodexHookEventName, string>;
}

export function expectedCodexHookScript(input: {
  hookScriptPath: string;
  wosmConfigPath?: string;
  hookBin?: string;
  wosmBin?: string;
}): string {
  const shellTmpDir = "$" + "{TMPDIR:-/tmp}";
  const legacyWosmBin = input.wosmBin;
  const hookArgs = [legacyWosmBin ?? input.hookBin ?? "wosm-hook"];
  if (input.wosmConfigPath !== undefined) {
    hookArgs.push("--config", input.wosmConfigPath);
  }
  if (legacyWosmBin !== undefined) {
    hookArgs.push("hook");
  }
  hookArgs.push("codex");
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `if [ -z "\${WOSM_SESSION_ID:-}" ] || [ -z "\${WOSM_WORKTREE_ID:-}" ]; then`,
    "  exit 0",
    "fi",
    `payload_file="$(mktemp "${shellTmpDir}/wosm-codex-hook.XXXXXX")"`,
    "trap 'rm -f \"$payload_file\"' EXIT",
    'cat > "$payload_file"',
    'event="$(/usr/bin/env node -e \'const fs = require("node:fs"); const input = fs.readFileSync(process.argv[1], "utf8"); const payload = JSON.parse(input); if (typeof payload.hook_event_name !== "string" || payload.hook_event_name.length === 0) { throw new Error("missing hook_event_name"); } process.stdout.write(payload.hook_event_name);\' "$payload_file")"',
    `${commandLine(hookArgs)} "$event" < "$payload_file" > /dev/null`,
    "",
  ].join("\n");
}

function installCommands(
  document: Record<string, unknown>,
  commands: Record<CodexHookEventName, string>,
): Record<string, unknown> {
  const next = cloneRecord(document);
  const hooks = isRecord(next.hooks) ? cloneRecord(next.hooks) : {};
  for (const eventName of CODEX_HOOK_EVENT_NAMES) {
    hooks[eventName] = withGeneratedHookEntry(hooks[eventName], eventName, commands[eventName]);
  }
  next.hooks = hooks;
  return next;
}

function uninstallCommands(
  document: Record<string, unknown>,
  commands: Record<CodexHookEventName, string>,
): Record<string, unknown> {
  const next = cloneRecord(document);
  if (!isRecord(next.hooks)) {
    return next;
  }
  const hooks = cloneRecord(next.hooks);
  for (const eventName of CODEX_HOOK_EVENT_NAMES) {
    const value = withoutGeneratedHookEntry(hooks[eventName], commands[eventName]);
    if (value === undefined) {
      delete hooks[eventName];
    } else {
      hooks[eventName] = value;
    }
  }
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  } else {
    next.hooks = hooks;
  }
  return next;
}

async function planLegacyGlobalCleanup(input: {
  baseConfigPath: string;
  profileConfigPath: string;
  commands: Record<CodexHookEventName, string>;
}): Promise<CodexLegacyGlobalCleanupStatus> {
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
  const afterDocument = uninstallCommands(document, input.commands);
  const after = stringifyTomlDocument(afterDocument);
  return {
    configPath: input.baseConfigPath,
    changed: before.trim() !== after.trim(),
    stale,
    before,
    after,
  };
}

function withGeneratedHookEntry(
  value: unknown,
  eventName: CodexHookEventName,
  command: string,
): unknown {
  const cleanedValue = withoutGeneratedHookEntry(value, command);
  const entries = hookEntries(cleanedValue);
  if (entries.some((entry) => hookEntryContainsCommand(entry, command))) {
    return entries;
  }
  const nextEntries = entries.slice();
  nextEntries.push(generatedHookEntry(eventName, command));
  return nextEntries;
}

function withoutGeneratedHookEntry(value: unknown, command: string): unknown {
  const entries = hookEntries(value);
  if (value !== undefined && entries.length === 0) {
    return value;
  }
  const nextEntries = entries
    .map((entry) => withoutGeneratedHooksFromEntry(entry, command))
    .filter((entry) => entry !== undefined);
  return nextEntries.length === 0 ? undefined : nextEntries;
}

function generatedHookEntry(
  eventName: CodexHookEventName,
  command: string,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    hooks: [
      {
        type: "command",
        command,
        timeout: 30,
        statusMessage: GENERATED_HOOK_STATUS_MESSAGE,
      },
    ],
  };
  const matcher = matcherForEvent(eventName);
  if (matcher !== undefined) {
    entry.matcher = matcher;
  }
  return entry;
}

function matcherForEvent(eventName: CodexHookEventName): string | undefined {
  if (eventName === "SessionStart") return "startup|resume|clear|compact";
  if (eventName === "PreToolUse") return ".*";
  if (eventName === "PermissionRequest") return ".*";
  if (eventName === "PostToolUse") return ".*";
  if (eventName === "PreCompact") return "manual|auto";
  if (eventName === "PostCompact") return "manual|auto";
  if (eventName === "SubagentStart") return ".*";
  if (eventName === "SubagentStop") return ".*";
  return undefined;
}

function hookEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value)) {
    return [value];
  }
  return [];
}

function hookContainsCommand(
  document: Record<string, unknown>,
  eventName: CodexHookEventName,
  command: string,
): boolean {
  if (!isRecord(document.hooks)) {
    return false;
  }
  return hookEntries(document.hooks[eventName]).some((entry) =>
    hookEntryContainsCommand(entry, command),
  );
}

function hookEntryContainsCommand(entry: Record<string, unknown>, command: string): boolean {
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) {
    return false;
  }
  return hooks.some((hook) => isRecord(hook) && hook.command === command);
}

function documentContainsCommand(document: Record<string, unknown>, command: string): boolean {
  if (!isRecord(document.hooks)) {
    return false;
  }
  return Object.values(document.hooks).some((value) =>
    hookEntries(value).some((entry) => hookEntryContainsCommand(entry, command)),
  );
}

function generatedWosmHookEvents(
  document: Record<string, unknown>,
  commands: Record<CodexHookEventName, string>,
): CodexHookEventName[] {
  if (!isRecord(document.hooks)) {
    return [];
  }
  const hooks = document.hooks;
  return CODEX_HOOK_EVENT_NAMES.filter((eventName) =>
    hookEntries(hooks[eventName]).some((entry) =>
      hookEntryContainsGeneratedWosmHook(entry, commands[eventName]),
    ),
  );
}

function hookEntryContainsGeneratedWosmHook(
  entry: Record<string, unknown>,
  command: string,
): boolean {
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) {
    return false;
  }
  return hooks.some((hook) => isGeneratedWosmHook(hook, command));
}

function isGeneratedWosmHook(hook: unknown, command: string): boolean {
  if (!isRecord(hook) || typeof hook.command !== "string") {
    return false;
  }
  if (hook.command === command) {
    return true;
  }
  return (
    hook.type === "command" &&
    hook.statusMessage === GENERATED_HOOK_STATUS_MESSAGE &&
    commandLooksLikeGeneratedHookScript(hook.command)
  );
}

function commandLooksLikeGeneratedHookScript(command: string): boolean {
  return (
    command === GENERATED_HOOK_SCRIPT_NAME || command.endsWith(`/${GENERATED_HOOK_SCRIPT_NAME}`)
  );
}

function withoutGeneratedHooksFromEntry(
  entry: Record<string, unknown>,
  command: string,
): Record<string, unknown> | undefined {
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) {
    return entry;
  }
  const nextHooks = hooks.filter((hook) => !isGeneratedWosmHook(hook, command));
  if (nextHooks.length === hooks.length) {
    return entry;
  }
  if (nextHooks.length > 0) {
    const next = cloneRecord(entry);
    next.hooks = nextHooks;
    return next;
  }
  const rest = cloneRecord(entry);
  delete rest.hooks;
  return Object.keys(rest).length === 0 || onlyGeneratedMatcherKeys(rest) ? undefined : rest;
}

function onlyGeneratedMatcherKeys(entry: Record<string, unknown>): boolean {
  return Object.keys(entry).every((key) => key === "matcher");
}

function missingDescription(plan: CodexHookPlan): string {
  const missing = plan.missing.length === 0 ? "none" : plan.missing.join(", ");
  return plan.scriptChanged ? `${missing}; script is missing or stale` : missing;
}

function doctorMessage(input: {
  installed: boolean;
  legacyGlobalInstalled: boolean;
  plan: CodexHookPlan;
}): string {
  if (input.installed && input.legacyGlobalInstalled) {
    return "Codex hooks are installed in the wosm profile, but generated global Codex hooks remain in the base config.";
  }
  if (input.installed) {
    return "Codex hooks are installed in the wosm profile.";
  }

  const missing = missingDescription(input.plan);
  if (input.legacyGlobalInstalled) {
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

function parseTomlDocument(source: string): Record<string, unknown> {
  if (source.trim().length === 0) {
    return {};
  }
  try {
    return parse(source) as Record<string, unknown>;
  } catch (cause) {
    throw new CodexHookSetupError("CODEX_HOOK_INVALID_TOML", "Codex config is not valid TOML.", {
      cause,
    });
  }
}

function stringifyTomlDocument(document: Record<string, unknown>): string {
  const result = stringify(document);
  return result.endsWith("\n") ? result : `${result}\n`;
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "ENOENT") {
      return "";
    }
    throw new CodexHookSetupError(
      "CODEX_HOOK_CONFIG_UNREADABLE",
      "Codex hook config could not be read.",
      { cause },
    );
  }
}

async function writeHookConfig(path: string, contents: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, contents, { mode: 0o600 });
  } catch (cause) {
    throw new CodexHookSetupError(
      "CODEX_HOOK_WRITE_FAILED",
      "Codex hook config could not be written.",
      { cause },
    );
  }
}

async function writeHookScript(path: string, contents: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, contents, { mode: 0o700 });
    await chmod(path, 0o700);
  } catch (cause) {
    throw new CodexHookSetupError(
      "CODEX_HOOK_WRITE_FAILED",
      "Codex hook script could not be written.",
      { cause },
    );
  }
}

async function removeHookScriptIfPresent(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "ENOENT") {
      return false;
    }
    throw new CodexHookSetupError(
      "CODEX_HOOK_WRITE_FAILED",
      "Codex hook script could not be removed.",
      { cause },
    );
  }
}

async function backupIfPresent(path: string): Promise<string | undefined> {
  try {
    await stat(path);
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "ENOENT") {
      return undefined;
    }
    throw new CodexHookSetupError(
      "CODEX_HOOK_CONFIG_UNREADABLE",
      "Codex hook config metadata could not be read.",
      { cause },
    );
  }
  const backupPath = `${path}.bak.${new Date().toISOString().replaceAll(/[^0-9]/g, "")}`;
  try {
    await copyFile(path, backupPath);
  } catch (cause) {
    throw new CodexHookSetupError(
      "CODEX_HOOK_WRITE_FAILED",
      "Codex hook config backup could not be written.",
      { cause },
    );
  }
  return backupPath;
}

function commandLine(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function defaultStateDir(options: CodexHookPlanOptions): string {
  const env = options.env ?? process.env;
  if (env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME.length > 0) {
    return join(env.XDG_STATE_HOME, "wosm");
  }
  return join(options.homeDir ?? homedir(), ".local", "state", "wosm");
}

function resolveCodexHome(options: CodexHookPlanOptions): string {
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  if (env.CODEX_HOME !== undefined && env.CODEX_HOME.length > 0) {
    return resolvePath(env.CODEX_HOME, homeDir);
  }
  return resolvePath("~/.codex", homeDir);
}

function resolvePath(input: string, homeDir: string): string {
  const expanded =
    input === "~" ? homeDir : input.startsWith("~/") ? join(homeDir, input.slice(2)) : input;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord(source: Record<string, unknown>): Record<string, unknown> {
  const cloned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    cloned[key] = value;
  }
  return cloned;
}
