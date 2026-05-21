import type { WosmConfig } from "@wosm/config";
import type { HookReceipt } from "@wosm/contracts";
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

  return receiveHookEvent(
    {
      provider,
      event,
      payload: parseHookPayload(options.stdin),
      config: options.config,
      paths: resolveObserverPaths(options.config),
    },
    deps,
  );
}

function parseHookPayload(stdin: string | undefined): unknown {
  const source = stdin?.trim();
  if (source === undefined || source.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(source);
  } catch {
    return source;
  }
}
