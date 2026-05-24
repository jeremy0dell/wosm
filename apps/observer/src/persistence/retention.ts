import type { ObservabilityRetentionConfig } from "@wosm/config";
import { mergeRetentionPolicy } from "@wosm/observability";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function providerObservationRetentionDays(retention?: ObservabilityRetentionConfig): number {
  return mergeRetentionPolicy(retention).sqlite.providerObservationsMaxDays;
}

export function providerObservationExpiresAt(observedAt: string, days: number): string {
  return addDays(observedAt, days);
}

export function providerObservationLegacyCutoff(now: string, days: number): string {
  return addDays(now, -days);
}

function addDays(timestamp: string, days: number): string {
  return new Date(Date.parse(timestamp) + days * MS_PER_DAY).toISOString();
}
