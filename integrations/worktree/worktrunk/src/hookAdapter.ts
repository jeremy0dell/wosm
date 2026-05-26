import type { ProviderHookAdapter } from "@wosm/contracts";
import { normalizeWorktrunkLifecycleEvent } from "./hooks.js";

export const worktrunkHookAdapter: ProviderHookAdapter = {
  provider: "worktrunk",
  kind: "worktree",
  normalizeEventName: normalizeWorktrunkLifecycleEvent,
};
