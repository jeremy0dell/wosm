import { runCli } from "@wosm/cli";
import { runObserverCommand } from "@wosm/cli/internal";
import type { ReconcileReceipt, WosmSnapshot } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("CLI manual-smoke commands", () => {
  it("defaults to the TUI when no subcommand is provided", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const sockets: string[] = [];

    const result = await runCli(["--config", configPath], {
      env: {},
      observerDeps: runningObserverDeps({ socketPath: fixture.socketPath }),
      tuiDeps: {
        runTui: async (options) => {
          sockets.push(options.socketPath);
          return { status: "exited", code: 0 };
        },
      },
    });

    expect(result).toEqual({
      code: 0,
      output: { status: "exited", code: 0 },
    });
    expect(sockets).toEqual([fixture.socketPath]);
  });

  it("prints the observer snapshot through snapshot --json", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const snapshot = snapshotFixture();

    const result = await runCli(["--config", configPath, "snapshot", "--json"], {
      observerDeps: runningObserverDeps({ socketPath: fixture.socketPath, snapshot }),
    });

    expect(result).toEqual({
      code: 0,
      output: snapshot,
    });
  });

  it("requests an immediate observer reconcile", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const reconciles: Array<string | undefined> = [];
    const receipt: ReconcileReceipt = {
      schemaVersion: "0.4.0",
      reason: "manual-smoke",
      reconciledAt: now,
      snapshot: snapshotFixture(),
    };

    const result = await runCli(["--config", configPath, "reconcile", "--reason", "manual-smoke"], {
      observerDeps: runningObserverDeps({
        socketPath: fixture.socketPath,
        reconcile: async (reason) => {
          reconciles.push(reason);
          return receipt;
        },
      }),
    });

    expect(result).toEqual({
      code: 0,
      output: receipt,
    });
    expect(reconciles).toEqual(["manual-smoke"]);
  });

  it("passes observer startup timeouts from observer commands", async () => {
    const fixture = await createTempState();
    await expect(
      runObserverCommand(
        ["start", "--timeout-ms"],
        { config: fixture.config },
        runningObserverDeps({ socketPath: fixture.socketPath }),
      ),
    ).rejects.toThrow("--timeout-ms requires a value.");
  });

  it("rejects malformed global config options before default command routing", async () => {
    await expect(runCli(["--config"])).rejects.toThrow("--config requires a value.");
    await expect(runCli(["--config", "doctor"])).rejects.toThrow("--config requires a value.");
  });
});

function runningObserverDeps(options: {
  socketPath: string;
  snapshot?: WosmSnapshot;
  reconcile?: (reason?: string) => Promise<ReconcileReceipt>;
}) {
  return {
    clientFactory: (socketPath: string) =>
      ({
        health: async () => ({
          schemaVersion: "0.4.0",
          status: "healthy",
          pid: 1234,
          startedAt: now,
          version: "0.0.0",
          socketPath,
        }),
        getSnapshot: async () => options.snapshot ?? snapshotFixture(),
        reconcile:
          options.reconcile ??
          (async (reason?: string) => ({
            schemaVersion: "0.4.0",
            reason: reason ?? "manual",
            reconciledAt: now,
            snapshot: options.snapshot ?? snapshotFixture(),
          })),
      }) as never,
    sleep: async () => undefined,
  };
}

function snapshotFixture(): WosmSnapshot {
  return {
    schemaVersion: "0.4.0",
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
  };
}
