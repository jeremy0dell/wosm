import { mkdtemp } from "node:fs/promises";
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
