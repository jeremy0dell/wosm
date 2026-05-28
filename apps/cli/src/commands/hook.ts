import { fileURLToPath } from "node:url";
import type { HookReceipt } from "@wosm/contracts";
import {
  type HookBridgeCommandOptions,
  type HookReceiverDeps,
  runHookBridgeCommand,
} from "@wosm/hook-bridge";
import { defaultProviderHookAdapters } from "@wosm/provider-hooks";

/**
 * @deprecated `wosm hook` is the legacy JSON-receipt wrapper. Generated provider
 * hooks should invoke `wosm-hook`, and internal callers should use
 * `@wosm/hook-bridge` directly.
 */
export type HookCommandOptions = HookBridgeCommandOptions;

/**
 * @deprecated Compatibility wrapper for older generated hooks and explicit manual
 * receipt checks. New hook entrypoints should go through `wosm-hook`.
 */
export async function runHookCommand(
  args: string[],
  options: HookCommandOptions = {},
  deps: HookReceiverDeps = {},
): Promise<HookReceipt> {
  const [provider, event] = args;
  if (provider === undefined || event === undefined) {
    throw new Error("Usage: wosm hook <provider> <event>");
  }
  const bridgeOptions: HookBridgeCommandOptions = { ...options };
  if (bridgeOptions.observerEntryPath === undefined) {
    bridgeOptions.observerEntryPath = defaultCliObserverEntryPath();
  }
  if (bridgeOptions.providerAdapters === undefined) {
    bridgeOptions.providerAdapters = defaultProviderHookAdapters;
  }
  return runHookBridgeCommand(args, bridgeOptions, deps);
}

function defaultCliObserverEntryPath(): string {
  return fileURLToPath(new URL("../../../observer/dist/runtime/main.js", import.meta.url));
}
