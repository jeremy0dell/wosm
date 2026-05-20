import { DatabaseSync } from "node:sqlite";
import type { SafeError } from "@wosm/contracts";
import type { RuntimeClock } from "@wosm/runtime";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";

export type ObserverSqliteHealthStatus = "healthy" | "unavailable" | "closed";

export type ObserverSqliteHealth = {
  path: string;
  open: boolean;
  status: ObserverSqliteHealthStatus;
  schemaVersion: number;
  lastCheckedAt: string;
  lastError?: SafeError;
};

export type ObserverSqliteHandle = {
  database: DatabaseSync;
  health(): ObserverSqliteHealth;
  close(): void;
};

export type OpenObserverSqliteOptions = {
  path?: string;
  clock?: RuntimeClock;
};

const schemaVersion = 1;

export function openObserverSqlite(options: OpenObserverSqliteOptions = {}): ObserverSqliteHandle {
  const path = options.path ?? ":memory:";
  const clock = options.clock ?? systemClock;
  const database = new DatabaseSync(path);
  let open = true;

  database.exec(`
    CREATE TABLE IF NOT EXISTS observer_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR REPLACE INTO observer_meta (key, value)
    VALUES ('schema_version', '${schemaVersion}');
  `);

  return {
    database,
    health: () => ({
      path,
      open,
      status: open ? "healthy" : "closed",
      schemaVersion,
      lastCheckedAt: toIsoTimestamp(clock.now()),
    }),
    close: () => {
      if (open) {
        database.close();
        open = false;
      }
    },
  };
}
