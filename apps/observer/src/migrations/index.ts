import { observerMetaMigration } from "./001_observer_meta.js";
import { persistenceHistoryMigration } from "./002_persistence_history.js";
import { diagnosticsTraceMigration } from "./003_diagnostics_trace.js";

export type ObserverSqliteMigration = {
  version: number;
  name: string;
  sql: string;
};

export const migrations = [
  observerMetaMigration,
  persistenceHistoryMigration,
  diagnosticsTraceMigration,
] as const;

export const latestSchemaVersion = migrations[migrations.length - 1]?.version ?? 0;
