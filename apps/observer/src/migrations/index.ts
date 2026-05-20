import { observerMetaMigration } from "./001_observer_meta";
import { persistenceHistoryMigration } from "./002_persistence_history";

export type ObserverSqliteMigration = {
  version: number;
  name: string;
  sql: string;
};

export const migrations = [observerMetaMigration, persistenceHistoryMigration] as const;

export const latestSchemaVersion = migrations[migrations.length - 1]?.version ?? 0;
