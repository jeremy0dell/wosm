import { spawn } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { type PiSupportedEventName, piSupportedEventNames } from "./eventNames.js";

type PiExtensionApi = {
  on: (
    event: PiSupportedEventName,
    handler: (event: unknown, context: unknown) => Promise<void>,
  ) => void;
};

type HookCommandInput = {
  eventType: PiSupportedEventName;
  payload: Record<string, unknown>;
};

type HookCommandChild = {
  once(event: "error", listener: (error: Error) => void): HookCommandChild;
  once(event: "close", listener: (code: number | null) => void): HookCommandChild;
  kill(): void;
  stdin?: {
    end(input: string): void;
  };
};

type HookCommandSpawner = (
  command: string,
  args: string[],
  options: {
    stdio: ["pipe", "ignore", "ignore"];
    env: NodeJS.ProcessEnv;
  },
) => HookCommandChild;

export type PiExtensionDeps = {
  env?: Record<string, string | undefined>;
  pid?: number;
  now?: () => Date;
  runHookCommand?: (input: HookCommandInput) => Promise<void>;
  spawnHookCommand?: HookCommandSpawner;
};

const hookTimeoutMs = 2500;

export function registerWosmPiExtension(pi: PiExtensionApi, deps: PiExtensionDeps = {}): void {
  for (const eventType of piSupportedEventNames) {
    pi.on(eventType, async (event, context) => {
      const payload = compactPiExtensionEvent(eventType, event, context, deps);
      try {
        await (deps.runHookCommand ?? defaultRunHookCommand(deps))({ eventType, payload });
      } catch {
        // Extension telemetry must never interrupt the user's Pi session.
      }
    });
  }
}

export default function wosmPiExtension(pi: PiExtensionApi): void {
  registerWosmPiExtension(pi);
}

export function compactPiExtensionEvent(
  eventType: PiSupportedEventName,
  event: unknown,
  context: unknown,
  deps: PiExtensionDeps = {},
): Record<string, unknown> {
  const env = deps.env ?? process.env;
  const eventRecord = asRecord(event);
  const contextRecord = asRecord(context);
  const sessionManager = asRecord(contextRecord?.sessionManager);
  const sessionFile = stringFromFunction(sessionManager, "getSessionFile");
  const cwd =
    stringField(contextRecord, "cwd") ??
    stringField(eventRecord, "cwd") ??
    env.WOSM_WORKTREE_PATH ??
    process.cwd();

  const payload: Record<string, unknown> = {
    event_type: eventType,
    cwd,
    pid: deps.pid ?? process.pid,
  };
  assignEnvField(payload, "wosm_project_id", env.WOSM_PROJECT_ID);
  assignEnvField(payload, "wosm_worktree_id", env.WOSM_WORKTREE_ID);
  assignEnvField(payload, "wosm_worktree_path", env.WOSM_WORKTREE_PATH);
  assignEnvField(payload, "wosm_session_id", env.WOSM_SESSION_ID);
  assignEnvField(payload, "wosm_terminal_provider", env.WOSM_TERMINAL_PROVIDER);
  assignEnvField(payload, "wosm_terminal_target_id", env.WOSM_TERMINAL_TARGET_ID);
  assignOptionalField(payload, "pi_session_file", sessionFile);
  assignOptionalField(
    payload,
    "pi_session_id",
    piSessionId(eventRecord, sessionManager, sessionFile),
  );
  assignOptionalField(payload, "model", modelSummary(eventRecord, contextRecord));

  if (eventType === "session_start") {
    assignOptionalField(payload, "reason", stringField(eventRecord, "reason"));
    assignOptionalField(
      payload,
      "previous_session_file",
      stringField(eventRecord, "previousSessionFile"),
    );
  }
  if (eventType === "session_shutdown") {
    assignOptionalField(payload, "reason", stringField(eventRecord, "reason"));
    assignOptionalField(
      payload,
      "target_session_file",
      stringField(eventRecord, "targetSessionFile"),
    );
  }
  if (eventType === "agent_end") {
    const messages = arrayField(eventRecord, "messages");
    if (messages !== undefined) {
      payload.message_count = messages.length;
    }
  }
  if (eventType === "turn_start") {
    assignOptionalField(payload, "turn_index", numberField(eventRecord, "turnIndex"));
  }
  if (eventType === "tool_execution_start" || eventType === "tool_execution_end") {
    assignOptionalField(payload, "tool_call_id", stringField(eventRecord, "toolCallId"));
    assignOptionalField(payload, "tool_name", stringField(eventRecord, "toolName"));
  }
  if (eventType === "tool_execution_end") {
    assignOptionalField(payload, "is_error", booleanField(eventRecord, "isError"));
  }
  if (eventType === "message_end") {
    const message = asRecord(eventRecord?.message);
    assignOptionalField(payload, "message_role", stringField(message, "role"));
  }
  if (eventType === "session_compact") {
    assignOptionalField(payload, "from_extension", booleanField(eventRecord, "fromExtension"));
    const compactionEntry = asRecord(eventRecord?.compactionEntry);
    assignOptionalField(payload, "compaction_entry_id", stringField(compactionEntry, "id"));
  }

  return payload;
}

function defaultRunHookCommand(deps: PiExtensionDeps): (input: HookCommandInput) => Promise<void> {
  return (input) =>
    new Promise((resolve, reject) => {
      const env = deps.env ?? process.env;
      const child = (deps.spawnHookCommand ?? spawn)("wosm-hook", hookCommandArgs(env, input), {
        stdio: ["pipe", "ignore", "ignore"],
        env: process.env,
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("wosm-hook timed out"));
      }, hookTimeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`wosm-hook exited with code ${code ?? "unknown"}`));
        }
      });
      child.stdin?.end(`${JSON.stringify(input.payload)}\n`);
    });
}

function hookCommandArgs(
  env: Record<string, string | undefined>,
  input: HookCommandInput,
): string[] {
  const args: string[] = [];
  if (env.WOSM_CONFIG_PATH !== undefined && env.WOSM_CONFIG_PATH.length > 0) {
    args.push("--config", env.WOSM_CONFIG_PATH);
  }
  args.push("pi", input.eventType);
  return args;
}

function piSessionId(
  event: Record<string, unknown> | undefined,
  sessionManager: Record<string, unknown> | undefined,
  sessionFile: string | undefined,
): string | undefined {
  return (
    stringField(event, "sessionId") ??
    stringField(event, "session_id") ??
    stringFromFunction(sessionManager, "getSessionId") ??
    sessionIdFromFile(sessionFile)
  );
}

function sessionIdFromFile(sessionFile: string | undefined): string | undefined {
  if (sessionFile === undefined) {
    return undefined;
  }
  const name = basename(sessionFile);
  const withoutJsonl = name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
  return withoutJsonl.length === 0 ? undefined : withoutJsonl;
}

function modelSummary(
  event: Record<string, unknown> | undefined,
  context: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  const source = asRecord(event?.model) ?? asRecord(context?.model);
  if (source === undefined) {
    return undefined;
  }
  const output: Record<string, string> = {};
  assignStringField(output, "provider", stringField(source, "provider"));
  assignStringField(output, "id", stringField(source, "id"));
  assignStringField(output, "name", stringField(source, "name"));
  return Object.keys(output).length === 0 ? undefined : output;
}

function assignEnvField(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined && value.length > 0) {
    target[key] = value;
  }
}

function assignOptionalField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function assignStringField(
  target: Record<string, string>,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function stringFromFunction(
  target: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const fn = target?.[key];
  if (typeof fn !== "function") {
    return undefined;
  }
  try {
    const value = fn.call(target);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function stringField(target: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = target?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(target: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = target?.[key];
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function booleanField(
  target: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = target?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function arrayField(
  target: Record<string, unknown> | undefined,
  key: string,
): unknown[] | undefined {
  const value = target?.[key];
  return Array.isArray(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export const wosmPiExtensionPath = fileURLToPath(
  new URL("../dist/piExtension.js", import.meta.url),
);
