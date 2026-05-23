import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WosmConfig } from "@wosm/config";
import { FakeHarnessProvider, FakeTerminalProvider, FakeWorktreeProvider } from "@wosm/testing";
import { describe, expect, it } from "vitest";
import {
  collectDiagnosticSnapshot,
  createObserverCore,
  createObserverPersistence,
  openObserverSqlite,
  ProviderRegistry,
  runDoctor,
} from "../../src/internal";

const now = "2026-05-20T12:00:00.000Z";

describe("observer diagnostics collector", () => {
  it("collects doctor and diagnostic snapshot data from fake providers", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wosm-observer-diag-"));
    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({
      path: join(stateDir, "observer.sqlite"),
      clock,
    });
    const persistence = createObserverPersistence({
      sqlite,
      clock,
      idFactory: ids(),
    });
    const providers = new ProviderRegistry({
      worktree: new ProviderDiagnosticWorktreeProvider({ now }),
      terminal: new FakeTerminalProvider({ now }),
      harnesses: [new FakeHarnessProvider({ now })],
    });
    const core = createObserverCore({
      config,
      providers,
      persistence,
      sqlite,
      clock,
    });

    await core.reconcile("diagnostics-test");
    const deps = {
      config,
      core,
      persistence,
      providers,
      paths: { stateDir },
      clock,
    };

    await expect(collectDiagnosticSnapshot(deps)).resolves.toMatchObject({
      schemaVersion: "0.3.0",
      providerHealth: {
        "fake-worktree": { status: "healthy" },
      },
      retention: {
        maxDays: 14,
      },
    });
    await expect(runDoctor(deps)).resolves.toMatchObject({
      status: "healthy",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "fake-provider-check",
          status: "ok",
        }),
      ]),
      debugBundle: {
        available: true,
      },
    });
    sqlite.close();
  });

  it("filters command-specific diagnostics and prioritizes matching logs", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wosm-observer-diag-filter-"));
    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({
      path: join(stateDir, "observer.sqlite"),
      clock,
    });
    const persistence = createObserverPersistence({
      sqlite,
      clock,
      idFactory: ids(),
    });
    const providers = new ProviderRegistry({
      worktree: new ProviderDiagnosticWorktreeProvider({ now }),
      terminal: new FakeTerminalProvider({ now }),
      harnesses: [new FakeHarnessProvider({ now })],
    });
    const core = createObserverCore({
      config,
      providers,
      persistence,
      sqlite,
      clock,
    });
    await persistence.recordCommandAccepted({
      commandId: "cmd_match",
      command: { type: "observer.reconcile", payload: { reason: "match" } },
      createdAt: now,
      traceId: "trc_match",
      spanId: "spn_match",
    });
    await persistence.markCommandFailed({
      commandId: "cmd_match",
      safeError: {
        tag: "WorktreeProviderError",
        code: "WORKTRUNK_BRANCH_EXISTS",
        message: "Branch exists.",
        provider: "worktrunk",
        commandId: "cmd_match",
        traceId: "trc_match",
      },
      envelope: {
        id: "err_match",
        tag: "WorktreeProviderError",
        code: "WORKTRUNK_BRANCH_EXISTS",
        message: "Branch exists.",
        severity: "error",
        commandId: "cmd_match",
        traceId: "trc_match",
        spanId: "spn_match",
        provider: "worktrunk",
        redacted: true,
        createdAt: now,
      },
      finishedAt: now,
    });
    const logPath = join(stateDir, "observer.jsonl");
    await writeFile(
      logPath,
      `${[
        JSON.stringify({
          timestamp: now,
          level: "error",
          component: "observer",
          message: "Command failed.",
          attributes: { commandId: "cmd_other", traceId: "trc_other" },
        }),
        JSON.stringify({
          timestamp: now,
          level: "error",
          component: "observer",
          message: "Command failed.",
          attributes: { commandId: "cmd_match", traceId: "trc_match" },
        }),
      ].join("\n")}\n`,
    );

    const snapshot = await collectDiagnosticSnapshot(
      {
        config,
        core,
        persistence,
        providers,
        paths: { stateDir, logPaths: [logPath] },
        clock,
      },
      { commandId: "cmd_match" },
    );

    expect(snapshot.commands.map((command) => command.id)).toEqual(["cmd_match"]);
    expect(snapshot.errors.map((error) => error.id)).toEqual(["err_match"]);
    expect(snapshot.logs[0]?.attributes).toMatchObject({ commandId: "cmd_match" });
    sqlite.close();
  });
});

class ProviderDiagnosticWorktreeProvider extends FakeWorktreeProvider {
  async doctorChecks() {
    return [
      {
        name: "fake-provider-check",
        status: "ok" as const,
        message: "Fake provider diagnostics are healthy.",
      },
    ];
  }
}

const config: WosmConfig = {
  schemaVersion: 1,
  defaults: {
    worktreeProvider: "fake-worktree",
    terminal: "fake-terminal",
    harness: "fake-harness",
    layout: "agent-shell",
  },
  projects: [],
};

function ids() {
  let event = 0;
  let observation = 0;
  return {
    eventId: () => `evt_${++event}`,
    observationId: () => `obs_${++observation}`,
  };
}
