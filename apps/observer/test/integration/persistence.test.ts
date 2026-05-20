import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderProjectConfig, WosmCommand } from "@wosm/contracts";
import { createFakeHarnessRun, createFakeTerminalTarget, createFakeWorktree } from "@wosm/testing";
import { describe, expect, it } from "vitest";
import { createErrorEnvelope, toSafeError } from "../../src/errors";
import { createObserverPersistence } from "../../src/persistence";
import { openObserverSqlite } from "../../src/sqlite";

const now = "2026-05-20T12:00:00.000Z";
const later = "2026-05-20T12:01:00.000Z";
const earlier = "2026-05-20T11:59:00.000Z";

const command: WosmCommand = {
  type: "observer.reconcile",
  payload: {
    reason: "persistence-test",
  },
};

const project: ProviderProjectConfig = {
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
};

function ids() {
  let event = 0;
  let observation = 0;
  let breadcrumb = 0;
  return {
    eventId: () => {
      event += 1;
      return `evt_${event}`;
    },
    observationId: () => {
      observation += 1;
      return `obs_${observation}`;
    },
    breadcrumbId: () => {
      breadcrumb += 1;
      return `crumb_${breadcrumb}`;
    },
  };
}

async function tempDbPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "wosm-observer-db-")), "observer.sqlite");
}

describe("observer persistence", () => {
  it("stores command lifecycle, event history, and SafeError separately from envelopes", async () => {
    const dbPath = await tempDbPath();
    const sqlite = openObserverSqlite({ path: dbPath, clock: { now: () => new Date(now) } });
    const persistence = createObserverPersistence({
      sqlite,
      clock: { now: () => new Date(now) },
      idFactory: ids(),
    });
    const internalError = new Error("internal sqlite detail");
    const safeError = toSafeError(internalError, {
      tag: "PersistenceError",
      code: "PERSISTENCE_WRITE_FAILED",
      message: "Observer persistence write failed.",
    });
    const envelope = createErrorEnvelope({
      id: "err_1",
      error: internalError,
      fallback: {
        tag: "PersistenceError",
        code: "PERSISTENCE_WRITE_FAILED",
        message: "Observer persistence write failed.",
      },
      commandId: "cmd_1",
      createdAt: now,
    });

    await persistence.recordCommandAccepted({ commandId: "cmd_1", command, createdAt: now });
    await persistence.markCommandStarted("cmd_1", now);
    await persistence.markCommandFailed({
      commandId: "cmd_1",
      safeError,
      envelope,
      finishedAt: later,
    });
    await persistence.recordEvent(
      {
        type: "command.failed",
        commandId: "cmd_1",
        error: safeError,
      },
      { commandId: "cmd_1", createdAt: later },
    );
    sqlite.close();

    const reopened = openObserverSqlite({ path: dbPath, clock: { now: () => new Date(later) } });
    const reloaded = createObserverPersistence({
      sqlite: reopened,
      clock: { now: () => new Date(later) },
      idFactory: ids(),
    });

    expect(await reloaded.listCommands()).toEqual([
      expect.objectContaining({
        id: "cmd_1",
        status: "failed",
        error: safeError,
      }),
    ]);
    expect(JSON.stringify((await reloaded.listCommands())[0]?.error)).not.toContain("internal");
    expect(await reloaded.listCommandErrors("cmd_1")).toEqual([
      expect.objectContaining({
        commandId: "cmd_1",
        envelope: expect.objectContaining({
          id: "err_1",
          stack: expect.stringContaining("internal sqlite detail"),
        }),
      }),
    ]);
    expect(await reloaded.listEvents({ commandId: "cmd_1" })).toEqual([
      expect.objectContaining({
        type: "command.failed",
        commandId: "cmd_1",
      }),
    ]);
    reopened.close();
  });

  it("expires and prunes provider observations", async () => {
    const sqlite = openObserverSqlite({ clock: { now: () => new Date(now) } });
    const persistence = createObserverPersistence({
      sqlite,
      clock: { now: () => new Date(now) },
      idFactory: ids(),
    });
    const activeWorktree = createFakeWorktree({ id: "wt_active", projectId: "web", now });
    const expiredWorktree = createFakeWorktree({ id: "wt_expired", projectId: "web", now });

    await persistence.recordProviderObservation({
      provider: "fake-worktree",
      providerType: "worktree",
      entityKind: "worktree",
      entityKey: activeWorktree.id,
      payload: activeWorktree,
      observedAt: now,
      expiresAt: later,
    });
    await persistence.recordProviderObservation({
      provider: "fake-worktree",
      providerType: "worktree",
      entityKind: "worktree",
      entityKey: expiredWorktree.id,
      payload: expiredWorktree,
      observedAt: now,
      expiresAt: earlier,
    });

    expect(
      (await persistence.listProviderObservations({ now })).map((item) => item.entityKey),
    ).toEqual(["wt_active"]);
    expect(await persistence.listProviderObservations({ includeExpired: true, now })).toHaveLength(
      2,
    );
    expect(await persistence.pruneExpiredProviderObservations(now)).toBe(1);
    expect(await persistence.listProviderObservations({ includeExpired: true, now })).toHaveLength(
      1,
    );
    sqlite.close();
  });

  it("persists correlation records across observer restart", async () => {
    const dbPath = await tempDbPath();
    const sqlite = openObserverSqlite({ path: dbPath, clock: { now: () => new Date(now) } });
    const persistence = createObserverPersistence({
      sqlite,
      clock: { now: () => new Date(now) },
      idFactory: ids(),
    });
    const worktree = createFakeWorktree({ id: "wt_web_main", projectId: "web", now });
    const terminal = createFakeTerminalTarget({
      id: "term_web_main",
      projectId: "web",
      worktreeId: "wt_web_main",
      sessionId: "ses_web_main",
      harnessRunId: "run_web_main",
      now,
    });
    const run = createFakeHarnessRun({
      id: "run_web_main",
      projectId: "web",
      worktreeId: "wt_web_main",
      sessionId: "ses_web_main",
      now,
    });

    await persistence.persistReconcileResult({
      projects: [project],
      worktrees: [worktree],
      terminalTargets: [terminal],
      harnessRuns: [run],
      observedAt: now,
    });
    sqlite.close();

    const reopened = openObserverSqlite({ path: dbPath, clock: { now: () => new Date(later) } });
    const reloaded = createObserverPersistence({ sqlite: reopened, idFactory: ids() });

    expect(await reloaded.listProjects()).toEqual([expect.objectContaining({ id: "web" })]);
    expect(await reloaded.listWorktrees()).toEqual([
      expect.objectContaining({ id: "wt_web_main" }),
    ]);
    expect(await reloaded.listTerminalTargets()).toEqual([
      expect.objectContaining({ id: "term_web_main", sessionId: "ses_web_main" }),
    ]);
    expect(await reloaded.listHarnessRuns()).toEqual([
      expect.objectContaining({ id: "run_web_main", sessionId: "ses_web_main" }),
    ]);
    expect(await reloaded.listSessions()).toEqual([
      expect.objectContaining({
        id: "ses_web_main",
        projectId: "web",
        worktreeId: "wt_web_main",
        harness: "fake-harness",
        terminalProvider: "fake-terminal",
      }),
    ]);
    reopened.close();
  });
});
