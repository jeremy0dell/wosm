import type { ObservabilityRetentionConfig } from "@wosm/config";
import { mergeRetentionPolicy } from "@wosm/observability";
import { addDays } from "../utils/time.js";

export function providerObservationRetentionDays(retention?: ObservabilityRetentionConfig): number {
  return mergeRetentionPolicy(retention).sqlite.providerObservationsMaxDays;
}

export function providerObservationExpiresAt(observedAt: string, days: number): string {
  return addDays(observedAt, days);
}

export function providerObservationLegacyCutoff(now: string, days: number): string {
  return addDays(now, -days);
}
