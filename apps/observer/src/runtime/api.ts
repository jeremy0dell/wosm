import type { ConfigDiagnostic, WosmConfig } from "@wosm/config";
import type {
  CommandId,
  CommandRecord,
  DiagnosticCollectionOptions,
  DiagnosticSnapshot,
  DoctorOptions,
  DoctorReport,
  EventFilter,
  HookReceipt,
  ObserverStopReceipt,
  ProviderHookEvent,
  ReconcileReceipt,
  WosmCommand,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import type { ObserverApi as ProtocolObserverApi } from "@wosm/protocol";
import { type RuntimeClock, runRuntimeBoundary, systemClock, toIsoTimestamp } from "@wosm/runtime";
import type { CommandQueue } from "../commands/queue.js";
import {
  collectDiagnosticSnapshot,
  type DiagnosticRuntimePaths,
  runDoctor,
} from "../diagnostics/collector.js";
import { createHookIngestion, type HookIngestion } from "../hooks/ingestion.js";
import { drainHookSpool, hookSpoolDepth } from "../hooks/spool.js";
import type { ObserverPersistence, PersistedCommand } from "../persistence/index.js";
import type { ObserverCore } from "../reconcile/core.js";
import type { ObserverEventBus } from "./eventBus.js";

export type CreateObserverApiOptions = {
  core: ObserverCore;
  persistence: ObserverPersistence;
  commandQueue: CommandQueue;
  eventBus: ObserverEventBus;
  clock?: RuntimeClock;
  hookIngestion?: HookIngestion;
  hookSpoolDir?: string;
  socketPath?: string;
  stateDir?: string;
  diagnosticsDir?: string;
  logPaths?: string[];
  logger?: JsonlLogger;
  config?: WosmConfig;
  configPath?: string;
  configDiagnostics?: ConfigDiagnostic[];
  onStop?: () => Promise<void> | void;
};

export type ObserverApi = ProtocolObserverApi;

export function createObserverApi(options: CreateObserverApiOptions): ObserverApi {
  const clock = options.clock ?? systemClock;
  let reconciling = false;
  let api: ObserverApi;
  const hookIngestion =
    options.hookIngestion ??
    createHookIngestion({
      persistence: options.persistence,
      eventBus: options.eventBus,
      clock,
      reconcile: (reason) => api.reconcile(reason),
    });

  api = {
    health: async () => {
      const coreHealth = options.core.getHealth();
      const snapshot = options.core.getSnapshot();
      const spoolDepth =
        options.hookSpoolDir === undefined ? undefined : await hookSpoolDepth(options.hookSpoolDir);

      return {
        schemaVersion: WOSM_SCHEMA_VERSION,
        status: coreHealth.status,
        pid: snapshot.observer.pid,
        startedAt: coreHealth.startedAt,
        version: snapshot.observer.version,
        ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
        ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
        uptimeMs: Math.max(
          0,
          Date.parse(toIsoTimestamp(clock.now())) - Date.parse(coreHealth.startedAt),
        ),
        ...(spoolDepth === undefined ? {} : { hookSpoolDepth: spoolDepth }),
        providerHealth: coreHealth.providerHealth,
        ...(coreHealth.sqlite === undefined ? {} : { sqlite: coreHealth.sqlite }),
        ...(coreHealth.lastReconcile === undefined
          ? {}
          : { lastReconcile: coreHealth.lastReconcile }),
      };
    },
    stop: async (): Promise<ObserverStopReceipt> => {
      await options.onStop?.();
      return {
        schemaVersion: WOSM_SCHEMA_VERSION,
        stopped: true,
        at: toIsoTimestamp(clock.now()),
      };
    },
    getSnapshot: async (): Promise<WosmSnapshot> => options.core.getSnapshot(),
    subscribe: (filter?: EventFilter): AsyncIterable<WosmEvent> =>
      options.eventBus.subscribe(filter),
    dispatch: (command: WosmCommand) => options.commandQueue.dispatch(command),
    getCommand: async (commandId: CommandId): Promise<CommandRecord | undefined> => {
      const command = await options.persistence.getCommand(commandId);
      return command === undefined ? undefined : toCommandRecord(command);
    },
    runDoctor: async (doctorOptions?: DoctorOptions): Promise<DoctorReport> =>
      runDoctor(diagnosticDeps(), doctorOptions),
    collectDiagnostics: async (
      diagnosticOptions?: DiagnosticCollectionOptions,
    ): Promise<DiagnosticSnapshot> =>
      collectDiagnosticSnapshot(diagnosticDeps(), diagnosticOptions),
    reconcile: async (reason = "manual"): Promise<ReconcileReceipt> => {
      if (!reconciling) {
        reconciling = true;
        try {
          await drainConfiguredSpool();
        } finally {
          reconciling = false;
        }
      }

      const result = await runRuntimeBoundary(
        {
          operation: "observer.reconcile",
          clock,
          error: {
            tag: "ObserverReconcileError",
            code: "OBSERVER_RECONCILE_FAILED",
            message: "Observer reconciliation failed.",
          },
        },
        () => options.core.reconcile(reason),
      );

      if (!result.ok) {
        throw result.error;
      }

      const event: WosmEvent = {
        type: "observer.reconciled",
        at: result.value.generatedAt,
        changed: 0,
      };
      options.eventBus.publish(event);
      return {
        schemaVersion: WOSM_SCHEMA_VERSION,
        reason,
        reconciledAt: result.value.generatedAt,
        snapshot: result.value,
      };
    },
    ingestHookEvent: (event: ProviderHookEvent): Promise<HookReceipt> =>
      hookIngestion.ingest(event),
  };

  async function drainConfiguredSpool(): Promise<void> {
    if (options.hookSpoolDir === undefined) {
      return;
    }
    const spoolDir = options.hookSpoolDir;

    const result = await runRuntimeBoundary(
      {
        operation: "observer.hookSpool.drain",
        clock,
        error: {
          tag: "HookSpoolError",
          code: "HOOK_SPOOL_DRAIN_FAILED",
          message: "Observer could not drain the hook spool.",
        },
      },
      () =>
        drainHookSpool({
          spoolDir,
          persistence: options.persistence,
          eventBus: options.eventBus,
          clock,
          ingest: (event) => hookIngestion.ingest(event, { triggerReconcile: false }),
        }),
    );

    if (!result.ok) {
      throw result.error;
    }
  }

  return api;

  function diagnosticDeps() {
    const stateDir = options.stateDir ?? process.cwd();
    const paths: DiagnosticRuntimePaths = {
      stateDir,
      ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
      ...(options.hookSpoolDir === undefined ? {} : { hookSpoolDir: options.hookSpoolDir }),
      diagnosticsDir: options.diagnosticsDir ?? `${stateDir}/diagnostics`,
      ...(options.logPaths === undefined ? {} : { logPaths: options.logPaths }),
    };
    return {
      config: options.config ?? emptyConfig(),
      ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
      ...(options.configDiagnostics === undefined
        ? {}
        : { configDiagnostics: options.configDiagnostics }),
      core: options.core,
      persistence: options.persistence,
      paths,
      clock,
    };
  }
}

function toCommandRecord(command: PersistedCommand): CommandRecord {
  return {
    id: command.id,
    type: command.type,
    command: command.command,
    status: command.status,
    createdAt: command.createdAt,
    ...(command.startedAt === undefined ? {} : { startedAt: command.startedAt }),
    ...(command.finishedAt === undefined ? {} : { finishedAt: command.finishedAt }),
    ...(command.traceId === undefined ? {} : { traceId: command.traceId }),
    ...(command.spanId === undefined ? {} : { spanId: command.spanId }),
    ...(command.error === undefined ? {} : { error: command.error }),
  };
}

function emptyConfig(): WosmConfig {
  return {
    schemaVersion: 1,
    defaults: {
      worktreeProvider: "noop-worktree",
      terminal: "noop-terminal",
      harness: "noop-harness",
      layout: "agent-shell",
    },
    projects: [],
  };
}
