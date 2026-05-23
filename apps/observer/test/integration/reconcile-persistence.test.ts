import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WosmConfig } from "@wosm/config";
import {
  createFakeHarnessRun,
  createFakeTerminalTarget,
  createFakeWorktree,
  FakeHarnessProvider,
  FakeTerminalProvider,
  FakeWorktreeProvider,
} from "@wosm/testing";
import { describe, expect, it } from "vitest";
import { createObserverCore, ProviderRegistry } from "../../src/internal";
import { createObserverPersistence } from "../../src/persistence";
import { openObserverSqlite } from "../../src/sqlite";

const now = "2026-05-20T12:00:00.000Z";

const config: WosmConfig = {
  schemaVersion: 1,
  defaults: {
    worktreeProvider: "fake-worktree",
    terminal: "fake-terminal",
    harness: "fake-harness",
    layout: "agent-shell",
  },
  projects: [
    {
      id: "web",
      label: "web",
      root: "/tmp/wosm/web",
      defaults: {
        harness: "fake-harness",
        terminal: "fake-terminal",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
      },
    },
  ],
};

function ids() {
  let event = 0;
  let observation = 0;
  return {
    eventId: () => {
      event += 1;
      return `evt_${event}`;
    },
    observationId: () => {
      observation += 1;
      return `obs_${observation}`;
    },
  };
}

async function tempDbPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "wosm-reconcile-db-")), "observer.sqlite");
}

function providersWithOneSession() {
  return new ProviderRegistry({
    worktree: new FakeWorktreeProvider({
      now,
      worktrees: [createFakeWorktree({ id: "wt_web_main", projectId: "web", now })],
    }),
    terminal: new FakeTerminalProvider({
      now,
      targets: [
        createFakeTerminalTarget({
          id: "term_web_main",
          projectId: "web",
          worktreeId: "wt_web_main",
          sessionId: "ses_web_main",
          harnessRunId: "run_web_main",
          now,
        }),
      ],
    }),
    harnesses: [
      new FakeHarnessProvider({
        now,
        runs: [
          createFakeHarnessRun({
            id: "run_web_main",
            projectId: "web",
            worktreeId: "wt_web_main",
            sessionId: "ses_web_main",
            state: "working",
            now,
          }),
        ],
      }),
    ],
  });
}

describe("observer reconcile persistence", () => {
  it("persists provider observations, session correlations, and reconcile events", async () => {
    const dbPath = await tempDbPath();
    const sqlite = openObserverSqlite({ path: dbPath, clock: { now: () => new Date(now) } });
    const persistence = createObserverPersistence({
      sqlite,
      clock: { now: () => new Date(now) },
      idFactory: ids(),
    });
    const core = createObserverCore({
      config,
      providers: providersWithOneSession(),
      persistence,
      sqlite,
      clock: { now: () => new Date(now) },
    });

    const snapshot = await core.reconcile("persistence-test");

    expect(snapshot.rows.map((row) => row.id)).toEqual(["wt_web_main"]);
    expect(await persistence.listSessions()).toEqual([
      expect.objectContaining({
        id: "ses_web_main",
        state: "working",
      }),
    ]);
    expect((await persistence.listProviderObservations()).map((item) => item.entityKind)).toEqual([
      "worktree",
      "terminal_target",
      "harness_run",
      "provider_health",
      "provider_health",
      "provider_health",
    ]);
    expect(await persistence.listEvents({ type: "observer.reconciled" })).toEqual([
      expect.objectContaining({
        type: "observer.reconciled",
        event: {
          type: "observer.reconciled",
          at: now,
          changed: 0,
        },
      }),
    ]);
    sqlite.close();

    const reopened = openObserverSqlite({ path: dbPath, clock: { now: () => new Date(now) } });
    const reloaded = createObserverPersistence({ sqlite: reopened, idFactory: ids() });
    expect(await reloaded.listSessions()).toEqual([
      expect.objectContaining({
        id: "ses_web_main",
        worktreeId: "wt_web_main",
      }),
    ]);
    reopened.close();
  });

  it("does not hydrate the live graph from stale SQLite records", async () => {
    const dbPath = await tempDbPath();
    const sqlite = openObserverSqlite({ path: dbPath, clock: { now: () => new Date(now) } });
    const persistence = createObserverPersistence({
      sqlite,
      clock: { now: () => new Date(now) },
      idFactory: ids(),
    });
    const firstCore = createObserverCore({
      config,
      providers: providersWithOneSession(),
      persistence,
      sqlite,
      clock: { now: () => new Date(now) },
    });
    await firstCore.reconcile("initial");

    const secondCore = createObserverCore({
      config,
      providers: new ProviderRegistry({
        worktree: new FakeWorktreeProvider({ now, worktrees: [] }),
        terminal: new FakeTerminalProvider({ now, targets: [] }),
        harnesses: [new FakeHarnessProvider({ now, runs: [] })],
      }),
      persistence,
      sqlite,
      clock: { now: () => new Date(now) },
    });
    const snapshot = await secondCore.reconcile("providers-empty");

    expect(await persistence.listWorktrees()).toEqual([
      expect.objectContaining({ id: "wt_web_main" }),
    ]);
    expect(snapshot.rows).toEqual([]);
    sqlite.close();
  });

  it("applies the latest correlated harness hook observation to discovered runs", async () => {
    const dbPath = await tempDbPath();
    const sqlite = openObserverSqlite({ path: dbPath, clock: { now: () => new Date(now) } });
    const persistence = createObserverPersistence({
      sqlite,
      clock: { now: () => new Date(now) },
      idFactory: ids(),
    });
    await persistence.recordProviderObservation({
      provider: "fake-harness",
      providerType: "harness",
      entityKind: "harness_event",
      entityKey: "run_web_main",
      observedAt: "2026-05-20T12:00:01.000Z",
      payload: {
        provider: "fake-harness",
        harnessRunId: "run_web_main",
        worktreeId: "wt_web_main",
        sessionId: "ses_web_main",
        rawEventType: "PermissionRequest",
        status: {
          value: "needs_attention",
          confidence: "high",
          reason: "Codex requested permission for Bash.",
          source: "harness_hook",
          updatedAt: "2026-05-20T12:00:01.000Z",
        },
        observedAt: "2026-05-20T12:00:01.000Z",
      },
    });
    const core = createObserverCore({
      config,
      providers: providersWithOneSession(),
      persistence,
      sqlite,
      clock: { now: () => new Date(now) },
    });

    const snapshot = await core.reconcile("hook-overlay");

    expect(snapshot.rows[0]?.agent).toMatchObject({
      state: "needs_attention",
      confidence: "high",
      reason: "Codex requested permission for Bash.",
    });
    expect(snapshot.projects[0]?.counts).toMatchObject({
      attention: 1,
      unknown: 0,
    });
    sqlite.close();
  });
});
