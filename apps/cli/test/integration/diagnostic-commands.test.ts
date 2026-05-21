import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli } from "@wosm/cli";
import type { DiagnosticSnapshot, DoctorReport } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("CLI diagnostic commands", () => {
  it("routes doctor through the observer diagnostics API", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const deps = {
      clientFactory: () =>
        ({
          health: async () => ({
            schemaVersion: "0.3.0",
            status: "healthy",
            pid: 1234,
            startedAt: now,
            version: "0.0.0",
          }),
          runDoctor: async () => doctorReport(fixture.stateDir),
        }) as never,
      sleep: async () => undefined,
    };

    await expect(
      runCli(["--config", configPath, "doctor"], { observerDeps: deps }),
    ).resolves.toMatchObject({
      code: 0,
      output: {
        schemaVersion: "0.3.0",
        status: "healthy",
        debugBundle: {
          available: true,
        },
      },
    });
  });

  it("collects diagnostics and writes a debug bundle", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const deps = {
      clientFactory: () =>
        ({
          health: async () => ({
            schemaVersion: "0.3.0",
            status: "healthy",
            pid: 1234,
            startedAt: now,
            version: "0.0.0",
          }),
          collectDiagnostics: async () => diagnosticSnapshot(),
        }) as never,
      sleep: async () => undefined,
    };

    const result = await runCli(["--config", configPath, "debug", "bundle"], {
      observerDeps: deps,
    });

    expect(result).toMatchObject({
      code: 0,
      output: {
        manifest: {
          sections: expect.arrayContaining(["manifest.json", "commands.jsonl"]),
        },
      },
    });
    const bundlePath = (result.output as { bundlePath: string }).bundlePath;
    await expect(readFile(join(bundlePath, "manifest.json"), "utf8")).resolves.toContain("diag_");
  });
});

function doctorReport(stateDir: string): DoctorReport {
  return {
    schemaVersion: "0.3.0",
    generatedAt: now,
    status: "healthy",
    checks: [{ name: "observer", status: "ok", message: "Observer is healthy." }],
    observer: {
      schemaVersion: "0.3.0",
      status: "healthy",
      pid: 1234,
      startedAt: now,
      version: "0.0.0",
    },
    config: { projectCount: 0, diagnostics: [] },
    providers: {},
    snapshot: diagnosticSnapshot().snapshot,
    logs: { paths: [], recent: [] },
    localState: {
      stateDir,
      totalBytes: 0,
      limitBytes: 262144000,
      overLimit: false,
      entries: [],
    },
    retention: diagnosticRetention(),
    recentErrors: [],
    debugBundle: {
      available: true,
      diagnosticsDir: join(stateDir, "diagnostics"),
    },
  };
}

function diagnosticSnapshot(): DiagnosticSnapshot {
  return {
    schemaVersion: "0.3.0",
    collectedAt: now,
    observerHealth: {
      schemaVersion: "0.3.0",
      status: "healthy",
      pid: 1234,
      startedAt: now,
      version: "0.0.0",
    },
    snapshot: {
      schemaVersion: "0.3.0",
      generatedAt: now,
      observer: { pid: 1234, startedAt: now, version: "0.0.0", healthy: true },
      providerHealth: {},
      projects: [],
      rows: [],
      sessions: [],
      counts: {
        projects: 0,
        worktrees: 0,
        agents: 0,
        working: 0,
        idle: 0,
        attention: 0,
        unknown: 0,
      },
      alerts: [],
    },
    providerHealth: {},
    commands: [
      {
        id: "cmd_1",
        type: "observer.reconcile",
        command: { type: "observer.reconcile", payload: { reason: "cli-test" } },
        status: "succeeded",
        createdAt: now,
        traceId: "trc_1",
        spanId: "spn_1",
      },
    ],
    events: [{ type: "command.succeeded", commandId: "cmd_1", traceId: "trc_1", spanId: "spn_1" }],
    errors: [],
    logs: [],
  };
}

function diagnosticRetention() {
  return {
    maxDays: 14,
    maxTotalMb: 250,
    maxFileMb: 10,
    maxFilesPerComponent: 5,
    components: {
      observerMaxMb: 100,
      cliMaxMb: 25,
      tuiMaxMb: 25,
      hookRunnerMaxMb: 25,
      providerMaxMb: 75,
    },
    sqlite: {
      eventsMaxDays: 30,
      commandsMaxDays: 60,
      errorsMaxDays: 60,
      providerObservationsMaxDays: 14,
    },
    debugBundles: { maxBundles: 10, maxDays: 30 },
    hookSpool: {
      deliveredDeleteImmediately: true,
      failedMaxDays: 7,
      failedMaxItems: 1000,
    },
  };
}
