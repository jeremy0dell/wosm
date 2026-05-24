import type { WosmConfig } from "@wosm/config";
import type { HookReceipt } from "@wosm/contracts";
import { HookReceiptSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";
import { resolveObserverPaths } from "./paths.js";
import { type HookReceiverDeps, type HookReceiverInput, receiveHookEvent } from "./receiver.js";

export type HookBridgeCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  stdin?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  observerEntryPath?: string | undefined;
};

export async function runHookBridgeCommand(
  args: string[],
  options: HookBridgeCommandOptions = {},
  deps: HookReceiverDeps = {},
): Promise<HookReceipt> {
  const [provider, event] = args;
  if (provider === undefined || event === undefined) {
    throw new Error("Usage: wosm-hook <provider> <event>");
  }
  const payload = parseHookPayload(options.stdin);
  if (!payload.ok) {
    const clock = deps.clock ?? systemClock;
    return HookReceiptSchema.parse({
      schemaVersion: WOSM_SCHEMA_VERSION,
      hookId: deps.hookId?.() ?? `hook_invalid_${Date.now()}`,
      provider,
      event,
      accepted: false,
      status: "rejected",
      receivedAt: toIsoTimestamp(clock.now()),
      error: {
        tag: "HookPayloadError",
        code: "HOOK_PAYLOAD_INVALID",
        message: "Hook stdin payload must be valid JSON.",
        provider,
      },
    });
  }

  const input: HookReceiverInput = {
    provider,
    event,
    paths: resolveObserverPaths(options.config),
  };
  if (options.config !== undefined) {
    input.config = options.config;
  }
  if (options.configPath !== undefined) {
    input.configPath = options.configPath;
  }
  if (options.observerEntryPath !== undefined) {
    input.observerEntryPath = options.observerEntryPath;
  }
  if (payload.value !== undefined) {
    input.payload = withCodexWosmContext(provider, payload.value, options.env ?? process.env);
  }

  return receiveHookEvent(input, deps);
}

function parseHookPayload(stdin: string | undefined):
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
    } {
  const source = stdin?.trim();
  if (source === undefined || source.length === 0) {
    return { ok: true, value: undefined };
  }

  try {
    return { ok: true, value: JSON.parse(source) };
  } catch {
    return { ok: false };
  }
}

function withCodexWosmContext(
  provider: string,
  payload: unknown,
  env: Record<string, string | undefined>,
): unknown {
  if (provider !== "codex" || !isRecord(payload)) {
    return payload;
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    next[key] = value;
  }
  assignEnvField(next, "wosm_project_id", env.WOSM_PROJECT_ID);
  assignEnvField(next, "wosm_worktree_id", env.WOSM_WORKTREE_ID);
  assignEnvField(next, "wosm_worktree_path", env.WOSM_WORKTREE_PATH);
  assignEnvField(next, "wosm_session_id", env.WOSM_SESSION_ID);
  assignEnvField(next, "wosm_terminal_provider", env.WOSM_TERMINAL_PROVIDER);
  assignEnvField(next, "wosm_terminal_target_id", env.WOSM_TERMINAL_TARGET_ID);
  return next;
}

function assignEnvField(target: Record<string, unknown>, key: string, value: string | undefined) {
  if (target[key] !== undefined || value === undefined || value.length === 0) {
    return;
  }
  target[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { HookReceiverDeps, HookReceiverInput } from "./receiver.js";
