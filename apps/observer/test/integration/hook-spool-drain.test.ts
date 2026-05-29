import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexHookPayloadToHarnessEventReport, compactCodexHookPayload } from "@wosm/codex";
import type { WosmConfig } from "@wosm/config";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { FakeHarnessProvider, FakeTerminalProvider, FakeWorktreeProvider } from "@wosm/testing";
import { describe, expect, it } from "vitest";
import { createTempSocketPath } from "../../../../tests/support/sockets";
import {
  fileExists,
  readHookSpoolRecord,
  writeHarnessEventReportSpoolRecordFixture,
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
} from "../../src/internal";

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
    await expect(readHookSpoolRecord(spoolDir, "spool_rejected.json")).resolves.toMatchObject({
      attempts: 1,
      lastError: {
        code: "HOOK_INGESTION_FAILED",
      },
    });
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

  it("starts the observer server without waiting for spool drain work to finish", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wosm-observer-state-"));
    const spoolDir = hookSpoolDir(stateDir);
    const spoolPath = await writeHookSpoolRecordFixture({ spoolDir, spoolId: "spool_startup" });
    const gate = deferred();
    const fixture = createFixture(spoolDir, {
      ingest: async (event) => {
        await gate.promise;
        return {
          schemaVersion: WOSM_SCHEMA_VERSION,
          hookId: event.hookId ?? "hook_startup",
          provider: event.provider,
          event: event.event,
          accepted: true,
          status: "ingested",
          receivedAt: event.receivedAt,
          reconciled: false,
        };
      },
    });
    const { socketPath } = await createTempSocketPath();

    const server = await startObserverServer({
      socketPath,
      api: fixture.api,
      clock: fixture.clock,
    });

    await expect(fileExists(spoolPath)).resolves.toBe(true);
    gate.resolve();
    await waitFor(async () => !(await fileExists(spoolPath)));
    await server.close();
    fixture.sqlite.close();
  });

  it("drains compacted Codex harness event report records without raw tool payloads", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wosm-observer-state-"));
    const spoolDir = hookSpoolDir(stateDir);
    const rawCommand = "pnpm test --raw-output";
    const compacted = compactCodexHookPayload({
      session_id: "codex_session_123",
      transcript_path: null,
      cwd: "/tmp/wosm/web/task",
      hook_event_name: "PreToolUse",
      model: "gpt-5.4-codex",
      permission_mode: "default",
      turn_id: "turn_1",
      tool_name: "Bash",
      tool_input: { command: rawCommand },
      tool_use_id: "call_test",
      wosm_worktree_id: "wt_web_task",
      wosm_session_id: "ses_web_task",
      wosm_terminal_target_id: "tmux:wosm:@1:%2",
    });
    const spoolPath = await writeHarnessEventReportSpoolRecordFixture({
      spoolDir,
      spoolId: "spool_codex_report_compacted",
      report: codexHookPayloadToHarnessEventReport({
        reportId: "report_codex_compacted",
        observedAt: now,
        payload: compacted.payload,
        diagnostics: {
          payloadBytes: compacted.originalByteCount,
          compactedBytes: compacted.compactedByteCount,
          compacted: compacted.compacted,
          omittedFieldNames: compacted.omittedFieldNames,
        },
      }),
    });
    const fixture = createFixture(spoolDir);

    await fixture.api.reconcile("manual");

    await expect(fileExists(spoolPath)).resolves.toBe(false);
    await expect(fixture.persistence.listProviderObservations()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "codex",
          providerType: "harness",
          entityKind: "harness_event",
          entityKey: "ses_web_task",
          payload: expect.objectContaining({
            provider: "codex",
            worktreeId: "wt_web_task",
            rawEventType: "PreToolUse",
            status: expect.objectContaining({
              value: "working",
              source: "harness_hook",
            }),
            providerData: expect.objectContaining({
              reportId: "report_codex_compacted",
              eventType: "PreToolUse",
            }),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(await fixture.persistence.listProviderObservations())).not.toContain(
      rawCommand,
    );
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}
