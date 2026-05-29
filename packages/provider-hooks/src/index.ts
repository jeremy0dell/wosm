import { codexHookAdapter } from "@wosm/codex";
import type { ProviderHookAdapter } from "@wosm/contracts";
import { piHookAdapter } from "@wosm/pi";
import { worktrunkHookAdapter } from "@wosm/worktrunk";

export * from "./command.js";
export * from "./deliveryPolicy.js";
export * from "./observerStartup.js";
export * from "./sender.js";
export * from "./spool.js";
export * from "./stdin.js";

export const defaultProviderHookAdapters: readonly ProviderHookAdapter[] = [
  codexHookAdapter,
  piHookAdapter,
  worktrunkHookAdapter,
];
