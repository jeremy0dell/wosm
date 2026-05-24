import { fileURLToPath } from "node:url";
import type { HookReceipt } from "@wosm/contracts";
import {
  type HookBridgeCommandOptions,
  type HookReceiverDeps,
  runHookBridgeCommand,
} from "@wosm/hook-bridge";

export type HookCommandOptions = HookBridgeCommandOptions;

export async function runHookCommand(
  args: string[],
  options: HookCommandOptions = {},
  deps: HookReceiverDeps = {},
): Promise<HookReceipt> {
  const bridgeOptions: HookBridgeCommandOptions = { ...options };
  if (bridgeOptions.observerEntryPath === undefined) {
    bridgeOptions.observerEntryPath = defaultCliObserverEntryPath();
  }
  return runHookBridgeCommand(args, bridgeOptions, deps);
}

function defaultCliObserverEntryPath(): string {
  return fileURLToPath(new URL("../../../observer/dist/runtime/main.js", import.meta.url));
}
