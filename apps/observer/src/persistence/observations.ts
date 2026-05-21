import type { DatabaseSync } from "node:sqlite";
import type { ProviderId } from "@wosm/contracts";
import {
  HarnessRunObservationSchema,
  TerminalTargetObservationSchema,
  WorktreeObservationSchema,
} from "@wosm/contracts";
import { stringifyJson } from "./json.js";
import { type ProviderObservationRow, providerObservationFromRow } from "./rows.js";
import type {
  PersistedProviderObservation,
  ProviderObservationKind,
  ProviderObservationType,
} from "./types.js";

export function insertProviderObservation(
  database: DatabaseSync,
  input: {
    id: string;
    provider: ProviderId;
    providerType: ProviderObservationType;
    entityKind: ProviderObservationKind;
    entityKey: string;
    payload: unknown;
    observedAt: string;
    expiresAt?: string | undefined;
  },
): PersistedProviderObservation {
  const payload = validateProviderObservationPayload(input.entityKind, input.payload);
  database
    .prepare(
      `
        INSERT OR REPLACE INTO provider_observations
          (id, provider, provider_type, entity_kind, entity_key, payload_json, observed_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.id,
      input.provider,
      input.providerType,
      input.entityKind,
      input.entityKey,
      stringifyJson(payload),
      input.observedAt,
      input.expiresAt ?? null,
    );

  return providerObservationFromRow(
    database
      .prepare("SELECT * FROM provider_observations WHERE id = ?")
      .get(input.id) as ProviderObservationRow,
    input.observedAt,
  );
}

export function listProviderObservations(
  database: DatabaseSync,
  options: {
    includeExpired?: boolean;
    referenceTime: string;
  },
): PersistedProviderObservation[] {
  const observations = (
    database
      .prepare("SELECT * FROM provider_observations ORDER BY observed_at, id")
      .all() as ProviderObservationRow[]
  ).map((row) => providerObservationFromRow(row, options.referenceTime));
  return options.includeExpired === true
    ? observations
    : observations.filter((observation) => !observation.expired);
}

export function pruneExpiredProviderObservations(
  database: DatabaseSync,
  expiresBefore: string,
): number {
  const result = database
    .prepare("DELETE FROM provider_observations WHERE expires_at IS NOT NULL AND expires_at <= ?")
    .run(expiresBefore);
  return Number(result.changes);
}

function validateProviderObservationPayload(
  kind: ProviderObservationKind,
  payload: unknown,
): unknown {
  if (kind === "worktree") {
    return WorktreeObservationSchema.parse(payload);
  }
  if (kind === "terminal_target") {
    return TerminalTargetObservationSchema.parse(payload);
  }
  if (kind === "harness_run") {
    return HarnessRunObservationSchema.parse(payload);
  }
  return payload;
}
