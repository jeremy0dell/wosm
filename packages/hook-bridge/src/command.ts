import type { WosmConfig } from "@wosm/config";
import type { HookReceipt } from "@wosm/contracts";
import { HookReceiptSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";
import { resolveObserverPaths } from "./paths.js";
import { enrichProviderHookPayload } from "./providerAdapters.js";
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
    input.payload = enrichProviderHookPayload({
      provider,
      payload: payload.value,
      env: options.env ?? process.env,
    });
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

export type { HookReceiverDeps, HookReceiverInput } from "./receiver.js";
