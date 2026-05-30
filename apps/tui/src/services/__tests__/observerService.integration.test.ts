import type {
  CommandId,
  CommandRecord,
  DiagnosticSnapshot,
  DoctorReport,
  HarnessEventReport,
  HarnessEventReportReceipt,
  HookReceipt,
  ObserverHealth,
  ObserverStopReceipt,
  ProviderHookEvent,
  ReconcileReceipt,
  WosmCommand,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import {
  listenUnixSocket,
  type ObserverApi,
  type ObserverClient,
  startProtocolServer,
  type TerminalCommandRecord,
} from "@wosm/protocol";
import { describe, expect, it } from "vitest";
import { createTempSocketPath } from "../../../../../tests/support/sockets";
import { createCommandSnapshot, fixtureNow } from "../../../test/fixtures/snapshots.js";
import { createTuiObserverService } from "../observerService.js";

describe("TUI observer service", () => {
  it("loads snapshots and dispatches commands through the observer protocol", async () => {
    const { socketPath } = await createTempSocketPath();
    const snapshot = createCommandSnapshot("idle");
    const commands: WosmCommand[] = [];
    const server = await startProtocolServer({
      socketPath,
      api: fakeApi({
        snapshot,
        dispatch: async (command) => {
          commands.push(command);
          return { commandId: "cmd_tui_1", accepted: true, status: "accepted" };
        },
      }),
    });
    const service = createTuiObserverService({ socketPath, requestId: ids("tui") });

    await expect(service.loadSnapshot()).resolves.toMatchObject({
      counts: { worktrees: 1 },
    });
    await expect(
      service.dispatch({ type: "observer.reconcile", payload: { reason: "tui-test" } }),
    ).resolves.toMatchObject({ commandId: "cmd_tui_1" });
    expect(commands).toHaveLength(1);

    await server.close();
  });

  it("maps protocol SafeErrors without dropping diagnostic IDs", async () => {
    const { socketPath } = await createTempSocketPath();
    const server = await startProtocolServer({
      socketPath,
      api: fakeApi({
        dispatch: async () => {
          throw {
            tag: "TerminalProviderError",
            code: "TERMINAL_TARGET_MISSING",
            message: "The terminal target for this worktree no longer exists.",
            diagnosticId: "diag_terminal_missing",
            traceId: "trc_terminal_missing",
          };
        },
      }),
    });
    const service = createTuiObserverService({ socketPath, requestId: ids("err") });

    await expect(
      service.dispatch({ type: "observer.reconcile", payload: { reason: "safe-error-test" } }),
    ).rejects.toMatchObject({
      code: "TERMINAL_TARGET_MISSING",
      diagnosticId: "diag_terminal_missing",
    });

    await server.close();
  });

  it("times out safely when the observer does not answer", async () => {
    const { socketPath } = await createTempSocketPath();
    const server = await listenUnixSocket({
      socketPath,
      onConnection: () => undefined,
    });
    const service = createTuiObserverService({
      socketPath,
      timeoutMs: 10,
      requestId: ids("timeout"),
    });

    try {
      await expect(service.loadSnapshot()).rejects.toMatchObject({
        tag: "TimeoutError",
      });
    } finally {
      await server.close();
    }
  });

  it("returns the underlying subscription iterator for cleanup", async () => {
    let returned = false;
    const service = createTuiObserverService({
      client: {
        health: async () => fakeHealth(),
        stop: async () => ({ schemaVersion: WOSM_SCHEMA_VERSION, stopped: true, at: fixtureNow }),
        getSnapshot: async () => createCommandSnapshot("idle"),
        dispatch: async () => ({ commandId: "cmd_1", accepted: true, status: "accepted" }),
        getCommand: async () => undefined,
        waitForCommand: async () => commandRecord("cmd_1", "succeeded") as TerminalCommandRecord,
        reconcile: async () => ({
          schemaVersion: WOSM_SCHEMA_VERSION,
          reason: "test",
          reconciledAt: fixtureNow,
          snapshot: createCommandSnapshot("idle"),
        }),
        ingestHookEvent: async (event: ProviderHookEvent) => ({
          schemaVersion: WOSM_SCHEMA_VERSION,
          hookId: "hook_1",
          provider: event.provider,
          event: event.event,
          accepted: true,
          status: "ingested",
          receivedAt: event.receivedAt,
          reconciled: true,
        }),
        runDoctor: async () => fakeDoctor(),
        collectDiagnostics: async () => fakeDiagnostics(),
        subscribe: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => new Promise<IteratorResult<WosmEvent>>(() => undefined),
            return: async () => {
              returned = true;
              return { done: true, value: undefined };
            },
          }),
        }),
      },
    });

    const iterator = service.subscribeEvents()[Symbol.asyncIterator]();
    await iterator.return?.();
    expect(returned).toBe(true);
  });

  it("maps succeeded terminal command records", async () => {
    const service = createTuiObserverService({
      client: fakeClient({
        waitForCommand: async (commandId) =>
          commandRecord(commandId, "succeeded") as TerminalCommandRecord,
      }),
    });

    await expect(service.waitForCommandCompletion("cmd_done")).resolves.toEqual({
      status: "succeeded",
      commandId: "cmd_done",
    });
  });

  it("maps failed terminal command records and preserves SafeError diagnostic context", async () => {
    const service = createTuiObserverService({
      client: fakeClient({
        waitForCommand: async (commandId) =>
          commandRecord(commandId, "failed") as TerminalCommandRecord,
      }),
    });

    await expect(service.waitForCommandCompletion("cmd_failed")).resolves.toEqual({
      status: "failed",
      commandId: "cmd_failed",
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TARGET_STALE",
        message: "The terminal target is stale.",
        diagnosticId: "diag_terminal_stale",
      },
    });
  });

  it("maps failed terminal command records without error payloads to a TUI-safe error", async () => {
    const service = createTuiObserverService({
      client: fakeClient({
        waitForCommand: async (commandId) => {
          const record = commandRecord(commandId, "failed");
          delete record.error;
          return record as TerminalCommandRecord;
        },
      }),
    });

    await expect(service.waitForCommandCompletion("cmd_missing_error")).resolves.toEqual({
      status: "failed",
      commandId: "cmd_missing_error",
      error: {
        tag: "TuiObserverError",
        code: "TUI_COMMAND_FAILED_WITHOUT_ERROR",
        message: "The observer command failed without an error payload.",
        commandId: "cmd_missing_error",
      },
    });
  });

  it("wraps protocol wait failures in TUI command wait errors", async () => {
    const service = createTuiObserverService({
      client: fakeClient({
        waitForCommand: async () => {
          throw {
            tag: "ProtocolError",
            code: "PROTOCOL_COMMAND_EVENT_STREAM_CLOSED",
            message: "Observer event stream closed before command completion.",
          };
        },
      }),
    });

    await expect(service.waitForCommandCompletion("cmd_closed")).rejects.toMatchObject({
      code: "TUI_COMMAND_WAIT_FAILED",
    });
  });

  it("times out while waiting for command completion", async () => {
    const service = createTuiObserverService({
      timeoutMs: 10,
      client: fakeClient({
        waitForCommand: async () => {
          throw {
            tag: "TimeoutError",
            code: "PROTOCOL_COMMAND_WAIT_TIMEOUT",
            message: "Observer command did not finish before the timeout.",
          };
        },
      }),
    });

    await expect(service.waitForCommandCompletion("cmd_hung")).rejects.toMatchObject({
      code: "TUI_COMMAND_WAIT_TIMEOUT",
    });
  });
});

function fakeApi(overrides: Partial<ObserverApi> & { snapshot?: WosmSnapshot } = {}): ObserverApi {
  const snapshot = overrides.snapshot ?? createCommandSnapshot("idle");
  return {
    health: overrides.health ?? (async () => fakeHealth()),
    stop:
      overrides.stop ??
      (async (): Promise<ObserverStopReceipt> => ({
        schemaVersion: WOSM_SCHEMA_VERSION,
        stopped: true,
        at: fixtureNow,
      })),
    getSnapshot: overrides.getSnapshot ?? (async () => snapshot),
    subscribe: overrides.subscribe ?? (() => stream([])),
    dispatch:
      overrides.dispatch ??
      (async () => ({ commandId: "cmd_1", accepted: true, status: "accepted" })),
    getCommand: overrides.getCommand ?? (async () => undefined),
    reconcile:
      overrides.reconcile ??
      (async (): Promise<ReconcileReceipt> => ({
        schemaVersion: WOSM_SCHEMA_VERSION,
        reason: "test",
        reconciledAt: fixtureNow,
        snapshot,
      })),
    ingestHookEvent:
      overrides.ingestHookEvent ??
      (async (event: ProviderHookEvent): Promise<HookReceipt> => ({
        schemaVersion: WOSM_SCHEMA_VERSION,
        hookId: "hook_1",
        provider: event.provider,
        event: event.event,
        accepted: true,
        status: "ingested",
        receivedAt: event.receivedAt,
        reconciled: true,
      })),
    reportHarnessEvent:
      overrides.reportHarnessEvent ??
      (async (report: HarnessEventReport): Promise<HarnessEventReportReceipt> => ({
        schemaVersion: WOSM_SCHEMA_VERSION,
        reportId: report.reportId,
        provider: report.provider,
        eventType: report.eventType,
        accepted: true,
        status: "accepted",
        receivedAt: report.observedAt,
        projected: false,
        scheduledReconcile: true,
      })),
    runDoctor: overrides.runDoctor ?? (async () => fakeDoctor()),
    collectDiagnostics: overrides.collectDiagnostics ?? (async () => fakeDiagnostics()),
  };
}

function fakeHealth(): ObserverHealth {
  return {
    schemaVersion: WOSM_SCHEMA_VERSION,
    status: "healthy",
    pid: 4242,
    startedAt: fixtureNow,
    version: "0.0.0",
  };
}

function fakeDoctor(): DoctorReport {
  return {
    schemaVersion: WOSM_SCHEMA_VERSION,
    status: "healthy",
    generatedAt: fixtureNow,
    checks: [],
  };
}

function fakeDiagnostics(): DiagnosticSnapshot {
  return {
    schemaVersion: WOSM_SCHEMA_VERSION,
    collectedAt: fixtureNow,
    commands: [],
    events: [],
    errors: [],
    logs: [],
    redaction: {
      policyVersion: "test",
      redactedFields: [],
      redactedValues: 0,
      suspiciousPatterns: [],
    },
  };
}

async function* stream(events: WosmEvent[]): AsyncIterable<WosmEvent> {
  for (const event of events) {
    yield event;
  }
}

function fakeClient(overrides: Partial<ObserverClient>): ObserverClient {
  return {
    health: async () => fakeHealth(),
    stop: async () => ({ schemaVersion: WOSM_SCHEMA_VERSION, stopped: true, at: fixtureNow }),
    getSnapshot: async () => createCommandSnapshot("idle"),
    dispatch: async () => ({ commandId: "cmd_1", accepted: true, status: "accepted" }),
    getCommand: async () => undefined,
    waitForCommand: async (commandId) =>
      commandRecord(commandId, "succeeded") as TerminalCommandRecord,
    reconcile: async () => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      reason: "test",
      reconciledAt: fixtureNow,
      snapshot: createCommandSnapshot("idle"),
    }),
    ingestHookEvent: async (event: ProviderHookEvent) => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      hookId: "hook_1",
      provider: event.provider,
      event: event.event,
      accepted: true,
      status: "ingested",
      receivedAt: event.receivedAt,
      reconciled: true,
    }),
    reportHarnessEvent: async (report: HarnessEventReport) => ({
      schemaVersion: WOSM_SCHEMA_VERSION,
      reportId: report.reportId,
      provider: report.provider,
      eventType: report.eventType,
      accepted: true,
      status: "accepted",
      receivedAt: report.observedAt,
      projected: false,
      scheduledReconcile: true,
    }),
    runDoctor: async () => fakeDoctor(),
    collectDiagnostics: async () => fakeDiagnostics(),
    subscribe: () => stream([]),
    ...overrides,
  };
}

function commandRecord(commandId: CommandId, status: CommandRecord["status"]): CommandRecord {
  const record: CommandRecord = {
    id: commandId,
    type: "terminal.focus",
    command: {
      type: "terminal.focus",
      payload: {
        targetId: "term_wt_web_idle_agent",
      },
    },
    status,
    createdAt: fixtureNow,
  };
  if (status === "started" || status === "succeeded" || status === "failed") {
    record.startedAt = fixtureNow;
  }
  if (status === "succeeded" || status === "failed") {
    record.finishedAt = fixtureNow;
  }
  if (status === "failed") {
    record.error = {
      tag: "TerminalProviderError",
      code: "TERMINAL_TARGET_STALE",
      message: "The terminal target is stale.",
      diagnosticId: "diag_terminal_stale",
    };
  }
  return record;
}

function ids(prefix: string): () => string {
  let id = 0;
  return () => `${prefix}_${++id}`;
}
