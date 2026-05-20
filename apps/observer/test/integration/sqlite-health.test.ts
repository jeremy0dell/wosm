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
      schemaVersion: 1,
      lastCheckedAt: now,
    });

    sqlite.close();

    expect(sqlite.health()).toMatchObject({
      path: ":memory:",
      open: false,
      status: "closed",
      schemaVersion: 1,
      lastCheckedAt: now,
    });
  });
});
