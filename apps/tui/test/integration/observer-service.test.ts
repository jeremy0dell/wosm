import type {
  CommandId,
  CommandRecord,
  DiagnosticSnapshot,
  DoctorReport,
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
} from "@wosm/protocol";
import { describe, expect, it } from "vitest";
import { createTempSocketPath } from "../../../../tests/support/sockets";
import { createTuiObserverService } from "../../src/services/observerService.js";
import { createCommandSnapshot, fixtureNow } from "../fixtures/snapshots.js";

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

  it("waits for an already-completed command without leaking the subscription", async () => {
    let returned = false;
    const service = createTuiObserverService({
      client: fakeClient({
        getCommand: async (commandId) => commandRecord(commandId, "succeeded"),
        subscribe: () =>
          cleanupStream(() => {
            returned = true;
          }),
      }),
    });

    await expect(service.waitForCommandCompletion("cmd_done")).resolves.toEqual({
      status: "succeeded",
      commandId: "cmd_done",
    });
    expect(returned).toBe(true);
  });

  it("waits for command.failed events and preserves SafeError diagnostic context", async () => {
    const service = createTuiObserverService({
      client: fakeClient({
        getCommand: async (commandId) => commandRecord(commandId, "started"),
        subscribe: () =>
          stream([
            {
              type: "command.failed",
              commandId: "cmd_failed",
              error: {
                tag: "TerminalProviderError",
                code: "TERMINAL_TARGET_STALE",
                message: "The terminal target is stale.",
                diagnosticId: "diag_terminal_stale",
              },
              traceId: "trc_failed",
            },
          ]),
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

  it("times out while waiting for command completion and cleans up the iterator", async () => {
    let returned = false;
    const service = createTuiObserverService({
      timeoutMs: 10,
      client: fakeClient({
        getCommand: async (commandId) => commandRecord(commandId, "started"),
        subscribe: () =>
          cleanupStream(() => {
            returned = true;
          }),
      }),
    });

    await expect(service.waitForCommandCompletion("cmd_hung")).rejects.toMatchObject({
      code: "TUI_COMMAND_WAIT_TIMEOUT",
    });
    expect(returned).toBe(true);
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

function cleanupStream(onReturn: () => void): AsyncIterable<WosmEvent> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => new Promise<IteratorResult<WosmEvent>>(() => undefined),
      return: async () => {
        onReturn();
        return { done: true, value: undefined };
      },
    }),
  };
}

function fakeClient(overrides: Partial<ObserverClient>): ObserverClient {
  return {
    health: async () => fakeHealth(),
    stop: async () => ({ schemaVersion: WOSM_SCHEMA_VERSION, stopped: true, at: fixtureNow }),
    getSnapshot: async () => createCommandSnapshot("idle"),
    dispatch: async () => ({ commandId: "cmd_1", accepted: true, status: "accepted" }),
    getCommand: async () => undefined,
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
