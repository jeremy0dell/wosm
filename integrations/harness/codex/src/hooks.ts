import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse, stringify } from "smol-toml";

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
  wosmBin?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export type CodexHookPlan = {
  provider: "codex";
  configPath: string;
  hookScriptPath: string;
  commands: Record<CodexHookEventName, string>;
  missing: CodexHookEventName[];
  changed: boolean;
  configChanged: boolean;
  scriptChanged: boolean;
  before: string;
  after: string;
};

export type CodexHookInstallResult = CodexHookPlan & {
  installed: boolean;
  backupPath?: string;
  scriptRemoved?: boolean;
};

export type CodexHookDoctorResult = {
  provider: "codex";
  configPath: string;
  hookScriptPath: string;
  status: "ok" | "warn";
  installed: boolean;
  missing: CodexHookEventName[];
  commands: Record<CodexHookEventName, string>;
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

  return {
    provider: "codex",
    configPath,
    hookScriptPath,
    commands,
    missing,
    changed: configChanged || scriptChanged,
    configChanged,
    scriptChanged,
    before,
    after,
  };
}

export async function installCodexHooks(
  options: CodexHookPlanOptions = {},
): Promise<CodexHookInstallResult> {
  const plan = await planCodexHooks(options);
  let backupPath: string | undefined;
  if (plan.configChanged) {
    backupPath = await backupIfPresent(plan.configPath);
    await writeHookConfig(plan.configPath, plan.after);
  }
  if (plan.scriptChanged) {
    await writeHookScript(
      plan.hookScriptPath,
      expectedCodexHookScript(scriptOptions(plan.hookScriptPath, options)),
    );
  }

  const result = installResultFromPlan(plan, true);
  if (backupPath !== undefined) {
    result.backupPath = backupPath;
  }
  return result;
}

function scriptOptions(
  hookScriptPath: string,
  options: Pick<CodexHookPlanOptions, "wosmConfigPath" | "wosmBin">,
): Parameters<typeof expectedCodexHookScript>[0] {
  const input: Parameters<typeof expectedCodexHookScript>[0] = { hookScriptPath };
  if (options.wosmConfigPath !== undefined) {
    input.wosmConfigPath = options.wosmConfigPath;
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
    hookScriptPath: plan.hookScriptPath,
    commands: plan.commands,
    missing: plan.missing,
    changed: plan.changed,
    configChanged: plan.configChanged,
    scriptChanged: plan.scriptChanged,
    before: plan.before,
    after: plan.after,
    installed,
  };
}

export async function uninstallCodexHooks(
  options: CodexHookPlanOptions = {},
): Promise<CodexHookInstallResult> {
  const configPath = resolveCodexConfigPath(options);
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
  let backupPath: string | undefined;
  if (configChanged) {
    backupPath = await backupIfPresent(configPath);
    await writeHookConfig(configPath, after);
  }
  const scriptRemoved = await removeHookScriptIfPresent(hookScriptPath);

  const result: CodexHookInstallResult = {
    provider: "codex",
    configPath,
    hookScriptPath,
    commands,
    missing,
    changed: configChanged || scriptRemoved,
    configChanged,
    scriptChanged: scriptRemoved,
    before,
    after,
    installed: false,
    scriptRemoved,
  };
  if (backupPath !== undefined) {
    result.backupPath = backupPath;
  }
  return result;
}

export async function doctorCodexHooks(
  options: CodexHookPlanOptions & { enabled?: boolean } = {},
): Promise<CodexHookDoctorResult> {
  const plan = await planCodexHooks(options);
  if (options.enabled === false) {
    return {
      provider: "codex",
      configPath: plan.configPath,
      hookScriptPath: plan.hookScriptPath,
      status: "ok",
      installed: false,
      missing: plan.missing,
      commands: plan.commands,
      message: "Codex hooks are not requested in wosm config.",
    };
  }

  const installed = plan.missing.length === 0 && !plan.scriptChanged;
  return {
    provider: "codex",
    configPath: plan.configPath,
    hookScriptPath: plan.hookScriptPath,
    status: installed ? "ok" : "warn",
    installed,
    missing: plan.missing,
    commands: plan.commands,
    message: installed
      ? "Codex hooks are installed."
      : `Codex hooks are missing or stale: ${missingDescription(plan)}.`,
  };
}

export function resolveCodexConfigPath(options: CodexHookPlanOptions = {}): string {
  if (options.codexConfigPath !== undefined) {
    return resolvePath(options.codexConfigPath, options.homeDir ?? homedir());
  }

  const env = options.env ?? process.env;
  if (env.CODEX_HOME !== undefined && env.CODEX_HOME.length > 0) {
    return resolvePath(join(env.CODEX_HOME, "config.toml"), options.homeDir ?? homedir());
  }
  return resolvePath("~/.codex/config.toml", options.homeDir ?? homedir());
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
  wosmBin?: string;
}): string {
  const shellTmpDir = "$" + "{TMPDIR:-/tmp}";
  const wosmArgs = [input.wosmBin ?? "wosm"];
  if (input.wosmConfigPath !== undefined) {
    wosmArgs.push("--config", input.wosmConfigPath);
  }
  wosmArgs.push("hook", "codex");
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `payload_file="$(mktemp "${shellTmpDir}/wosm-codex-hook.XXXXXX")"`,
    "trap 'rm -f \"$payload_file\"' EXIT",
    'cat > "$payload_file"',
    'event="$(/usr/bin/env node -e \'const fs = require("node:fs"); const input = fs.readFileSync(process.argv[1], "utf8"); const payload = JSON.parse(input); if (typeof payload.hook_event_name !== "string" || payload.hook_event_name.length === 0) { throw new Error("missing hook_event_name"); } process.stdout.write(payload.hook_event_name);\' "$payload_file")"',
    `${commandLine(wosmArgs)} "$event" < "$payload_file" > /dev/null`,
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

function withGeneratedHookEntry(
  value: unknown,
  eventName: CodexHookEventName,
  command: string,
): unknown {
  const entries = hookEntries(value);
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
    .map((entry) => withoutCommandFromEntry(entry, command))
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
        statusMessage: "Notify wosm",
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

function withoutCommandFromEntry(
  entry: Record<string, unknown>,
  command: string,
): Record<string, unknown> | undefined {
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) {
    return entry;
  }
  const nextHooks = hooks.filter((hook) => !(isRecord(hook) && hook.command === command));
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
