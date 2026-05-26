import { parse, stringify } from "smol-toml";
import {
  CODEX_HOOK_EVENT_NAMES,
  type CodexHookEventName,
  GENERATED_HOOK_SCRIPT_NAME,
  GENERATED_HOOK_STATUS_MESSAGE,
} from "./hookConstants.js";
import { CodexHookSetupError } from "./hookErrors.js";

export function parseTomlDocument(source: string): Record<string, unknown> {
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

export function stringifyTomlDocument(document: Record<string, unknown>): string {
  const result = stringify(document);
  return result.endsWith("\n") ? result : `${result}\n`;
}

export function installCodexHookCommands(
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

export function removeGeneratedCodexHookCommands(
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

export function missingCodexHookEvents(
  document: Record<string, unknown>,
  commands: Record<CodexHookEventName, string>,
): CodexHookEventName[] {
  return CODEX_HOOK_EVENT_NAMES.filter(
    (eventName) => !hookContainsCommand(document, eventName, commands[eventName]),
  );
}

export function documentContainsCommand(
  document: Record<string, unknown>,
  command: string,
): boolean {
  if (!isRecord(document.hooks)) {
    return false;
  }
  return Object.values(document.hooks).some((value) =>
    hookEntries(value).some((entry) => hookEntryContainsCommand(entry, command)),
  );
}

export function generatedWosmHookEvents(
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

function hookEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value)) {
    return [value];
  }
  return [];
}

function hookEntryContainsCommand(entry: Record<string, unknown>, command: string): boolean {
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) {
    return false;
  }
  return hooks.some((hook) => isRecord(hook) && hook.command === command);
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
