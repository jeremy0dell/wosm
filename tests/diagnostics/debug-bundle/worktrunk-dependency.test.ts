import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WosmConfig } from "@wosm/config";
import { writeDebugBundle } from "@wosm/observability";
import {
  collectDiagnosticSnapshot,
  createObserverCore,
  createObserverPersistence,
  openObserverSqlite,
  ProviderRegistry,
} from "@wosm/observer/internal";
import { FakeHarnessProvider, FakeTerminalProvider } from "@wosm/testing";
import { WorktrunkProvider } from "@wosm/worktrunk";
import { describe, expect, it } from "vitest";

const now = "2026-05-21T12:00:00.000Z";

describe("Worktrunk dependency debug bundle diagnostics", () => {
  it("includes missing wt command evidence in provider health", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-wt-debug-"));
    const stateDir = join(root, "state");
    const diagnosticsDir = join(stateDir, "diagnostics");
    await mkdir(diagnosticsDir, { recursive: true });

    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({ path: join(stateDir, "observer.sqlite"), clock });
    const persistence = createObserverPersistence({ sqlite, clock, idFactory: ids() });
    const config = wosmConfig(stateDir);
    const providers = new ProviderRegistry({
      worktree: new WorktrunkProvider({
        command: "missing-wt",
        clock,
        runner: async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
      }),
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

    await core.reconcile("worktrunk-dependency");
    const snapshot = await collectDiagnosticSnapshot({
      config,
      configPath: join(root, "config.toml"),
      core,
      persistence,
      paths: { stateDir, diagnosticsDir },
      clock,
    });
    const manifest = await writeDebugBundle({
      diagnosticsDir,
      snapshot,
      now: new Date(now),
      bundleId: "diag_worktrunk_dependency",
    });

    const providerHealth = await readFile(
      join(manifest.bundlePath, "provider-health.json"),
      "utf8",
    );
    expect(providerHealth).toContain("WORKTRUNK_UNAVAILABLE");
    expect(providerHealth).toContain("attemptedCommand");
    expect(providerHealth).toContain("missing-wt");
    expect(providerHealth).toContain("brew install worktrunk");

    sqlite.close();
  });
});

function wosmConfig(stateDir: string): WosmConfig {
  return {
    schemaVersion: 1,
    observer: {
      stateDir,
    },
    defaults: {
      worktreeProvider: "worktrunk",
      terminal: "fake-terminal",
      harness: "fake-harness",
      layout: "agent-shell",
    },
    projects: [],
  };
}

function ids() {
  let event = 0;
  let observation = 0;
  return {
    eventId: () => `evt_${++event}`,
    observationId: () => `obs_${++observation}`,
  };
}
