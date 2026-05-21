import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WosmConfig } from "@wosm/config";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { FakeHarnessProvider, FakeTerminalProvider, FakeWorktreeProvider } from "@wosm/testing";
import { describe, expect, it } from "vitest";
import { createTempSocketPath } from "../../../../tests/support/sockets";
import {
  fileExists,
  writeHookSpoolRecordFixture,
  writeInvalidHookSpoolFile,
} from "../../../../tests/support/spool";
import {
  createCommandQueue,
  createObserverApi,
  createObserverCore,
  createObserverEventBus,
  createObserverPersistence,
  drainHookSpool,
  type HookIngestion,
  hookSpoolDir,
  openObserverSqlite,
  ProviderRegistry,
  startObserverServer,
} from "../../src";

const now = "2026-05-20T12:00:00.000Z";

describe("observer hook spool drain", () => {
  it("drains valid spool files on reconcile and deletes only successful records", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wosm-observer-state-"));
    const spoolDir = hookSpoolDir(stateDir);
    await writeHookSpoolRecordFixture({ spoolDir, spoolId: "spool_1" });
    const fixture = createFixture(spoolDir);

    await fixture.api.reconcile("manual");

    await expect(stat(join(spoolDir, "spool_1.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fixture.persistence.listEvents()).map((event) => event.type)).toEqual([
      "hook.ingested",
      "hook.spoolDrained",
      "observer.reconciled",
    ]);
    fixture.sqlite.close();
  });

  it("keeps invalid spool files, continues valid records, and counts failures", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wosm-observer-state-"));
    const spoolDir = hookSpoolDir(stateDir);
    const invalidPath = await writeInvalidHookSpoolFile({ spoolDir, fileName: "bad.json" });
    const validPath = await writeHookSpoolRecordFixture({ spoolDir, spoolId: "spool_valid" });
    const fixture = createFixture(spoolDir);

    await fixture.api.reconcile("manual");

    await expect(fileExists(invalidPath)).resolves.toBe(true);
    await expect(fileExists(validPath)).resolves.toBe(false);
    const drainEvent = (await fixture.persistence.listEvents()).find(
      (event) => event.type === "hook.spoolDrained",
    );
    expect(drainEvent?.event).toMatchObject({
      type: "hook.spoolDrained",
      drained: 1,
      failed: 1,
    });
    fixture.sqlite.close();
  });

  it("leaves rejected spool records in place and publishes failed drain counts", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wosm-observer-state-"));
    const spoolDir = hookSpoolDir(stateDir);
    const successPath = await writeHookSpoolRecordFixture({
      spoolDir,
      spoolId: "spool_success",
      event: { event: "worktree.created" },
    });
    const rejectedPath = await writeHookSpoolRecordFixture({
      spoolDir,
      spoolId: "spool_rejected",
      event: { event: "worktree.rejected" },
    });
    const fixture = createFixture(spoolDir);
    const drainEvents = fixture.eventBus
      .subscribe({ type: "hook.spoolDrained" })
      [Symbol.asyncIterator]();
    const nextDrainEvent = drainEvents.next();

    const result = await drainHookSpool({
      spoolDir,
      persistence: fixture.persistence,
      eventBus: fixture.eventBus,
      clock: fixture.clock,
      ingest: async (event) => ({
        schemaVersion: WOSM_SCHEMA_VERSION,
        hookId: `hook_${event.event}`,
        provider: event.provider,
        event: event.event,
        accepted: event.event !== "worktree.rejected",
        status: event.event === "worktree.rejected" ? "rejected" : "ingested",
        receivedAt: event.receivedAt,
        ...(event.event === "worktree.rejected"
          ? {
              error: {
                tag: "HookIngestionError",
                code: "HOOK_INGESTION_FAILED",
                message: "Hook event was rejected safely.",
                provider: event.provider,
              },
            }
          : { reconciled: false }),
      }),
    });

    expect(result).toEqual({ scanned: 2, drained: 1, failed: 1 });
    await expect(fileExists(successPath)).resolves.toBe(false);
    await expect(fileExists(rejectedPath)).resolves.toBe(true);
    await expect(nextDrainEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "hook.spoolDrained",
        drained: 1,
        failed: 1,
      },
    });
    await drainEvents.return?.();
    fixture.sqlite.close();
  });

  it("drains spool during observer server startup", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wosm-observer-state-"));
    const spoolDir = hookSpoolDir(stateDir);
    await writeHookSpoolRecordFixture({ spoolDir, spoolId: "spool_startup" });
    const fixture = createFixture(spoolDir);
    const { socketPath } = await createTempSocketPath();

    const server = await startObserverServer({
      socketPath,
      api: fixture.api,
      clock: fixture.clock,
    });

    await expect(readFile(join(spoolDir, "spool_startup.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await server.close();
    fixture.sqlite.close();
  });
});

function createFixture(spoolDir: string, hookIngestion?: HookIngestion) {
  const clock = { now: () => new Date(now) };
  const sqlite = openObserverSqlite({ clock });
  const persistence = createObserverPersistence({
    sqlite,
    clock,
    idFactory: ids(),
  });
  const eventBus = createObserverEventBus();
  const core = createObserverCore({
    config,
    providers: new ProviderRegistry({
      worktree: new FakeWorktreeProvider({ now }),
      terminal: new FakeTerminalProvider({ now }),
      harnesses: [new FakeHarnessProvider({ now })],
    }),
    persistence,
    sqlite,
    clock,
  });
  const queue = createCommandQueue({ persistence, clock, idFactory: ids(), eventBus });
  const api = createObserverApi({
    core,
    persistence,
    commandQueue: queue,
    eventBus,
    ...(hookIngestion === undefined ? {} : { hookIngestion }),
    hookSpoolDir: spoolDir,
    clock,
  });
  return { api, eventBus, persistence, sqlite, clock };
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
  let command = 0;
  let event = 0;
  let observation = 0;
  let breadcrumb = 0;
  return {
    commandId: () => `cmd_${++command}`,
    eventId: () => `evt_${++event}`,
    observationId: () => `obs_${++observation}`,
    breadcrumbId: () => `crumb_${++breadcrumb}`,
  };
}
