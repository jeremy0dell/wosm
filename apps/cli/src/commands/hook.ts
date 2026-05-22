import type { WosmConfig } from "@wosm/config";
import type { HookReceipt } from "@wosm/contracts";
import { HookReceiptSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";
import { type HookReceiverDeps, receiveHookEvent } from "../hookReceiver.js";
import { resolveObserverPaths } from "../paths.js";

export type HookCommandOptions = {
  config?: WosmConfig | undefined;
  stdin?: string | undefined;
};

export async function runHookCommand(
  args: string[],
  options: HookCommandOptions = {},
  deps: HookReceiverDeps = {},
): Promise<HookReceipt> {
  const [provider, event] = args;
  if (provider === undefined || event === undefined) {
    throw new Error("Usage: wosm hook <provider> <event>");
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

  return receiveHookEvent(
    {
      provider,
      event,
      payload: payload.value,
      config: options.config,
      paths: resolveObserverPaths(options.config),
    },
    deps,
  );
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
