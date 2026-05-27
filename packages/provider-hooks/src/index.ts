import { codexHookAdapter } from "@wosm/codex";
import type { ProviderHookAdapter } from "@wosm/contracts";
import { piHookAdapter } from "@wosm/pi";
import { worktrunkHookAdapter } from "@wosm/worktrunk";

export const defaultProviderHookAdapters: readonly ProviderHookAdapter[] = [
  codexHookAdapter,
  piHookAdapter,
  worktrunkHookAdapter,
];
