import { fileURLToPath } from "node:url";
import { codexHookAdapter } from "@wosm/codex";
import type { HookReceipt, ProviderHookAdapter } from "@wosm/contracts";
import {
  type HookBridgeCommandOptions,
  type HookReceiverDeps,
  runHookBridgeCommand,
} from "@wosm/hook-bridge";
import { worktrunkHookAdapter } from "@wosm/worktrunk";

/**
 * @deprecated `wosm hook` is the legacy JSON-receipt wrapper. Generated provider
 * hooks should invoke `wosm-hook`, and internal callers should use
 * `@wosm/hook-bridge` directly.
 */
export type HookCommandOptions = HookBridgeCommandOptions;

const defaultProviderHookAdapters: readonly ProviderHookAdapter[] = [
  codexHookAdapter,
  worktrunkHookAdapter,
];

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
