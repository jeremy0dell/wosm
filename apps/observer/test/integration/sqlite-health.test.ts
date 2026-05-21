import { describe, expect, it } from "vitest";
import { openObserverSqlite } from "../../src/sqlite";

const now = "2026-05-20T12:00:00.000Z";

describe("observer SQLite health", () => {
  it("initializes an in-memory database, reports health, and closes cleanly", () => {
    const sqlite = openObserverSqlite({
      path: ":memory:",
      clock: {
        now: () => new Date(now),
      },
    });

    expect(sqlite.health()).toMatchObject({
      path: ":memory:",
      open: true,
      status: "healthy",
      schemaVersion: 3,
      lastCheckedAt: now,
    });
    expect(sqlite.health().migrations.map((migration) => migration.version)).toEqual([1, 2, 3]);

    sqlite.close();

    expect(sqlite.health()).toMatchObject({
      path: ":memory:",
      open: false,
      status: "closed",
      schemaVersion: 3,
      lastCheckedAt: now,
    });
  });
});
