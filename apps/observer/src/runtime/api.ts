import type { ConfigDiagnostic, WosmConfig } from "@wosm/config";
import type {
  CommandId,
  CommandRecord,
  DiagnosticCollectionOptions,
  DiagnosticSnapshot,
  DoctorOptions,
  DoctorReport,
  EventFilter,
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
import { HarnessEventReportReceiptSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import type { ObserverApi as ProtocolObserverApi } from "@wosm/protocol";
import { type RuntimeClock, runRuntimeBoundary, systemClock, toIsoTimestamp } from "@wosm/runtime";
import type { CommandQueue } from "../commands/queue.js";
import {
  collectDiagnosticSnapshot,
  type DiagnosticRuntimePaths,
  type ObserverDiagnosticsDeps,
  runDoctor,
} from "../diagnostics/collector.js";
import {
  createHarnessEventReportIngestion,
  createHookIngestion,
  type HarnessEventReportIngestion,
  type HookIngestion,
} from "../hooks/ingestion.js";
import { drainHookSpool, hookSpoolDepth } from "../hooks/spool.js";
import {
  createWorktreeMetadataRefreshService,
  type WorktreeMetadataRefreshService,
} from "../metadata/refresh.js";
import type { ObserverPersistence, PersistedCommand } from "../persistence/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { type ObserverCore, providerProjectsFromConfig } from "../reconcile/core.js";
import type { ObserverEventBus } from "./eventBus.js";
import {
  type CreateReconcileSchedulerOptions,
  createReconcileScheduler,
} from "./reconcileScheduler.js";

export type CreateObserverApiOptions = {
  core: ObserverCore;
  providers?: ProviderRegistry;
  persistence: ObserverPersistence;
  commandQueue: CommandQueue;
  eventBus: ObserverEventBus;
  clock?: RuntimeClock;
  hookIngestion?: HookIngestion;
  harnessEventReportIngestion?: HarnessEventReportIngestion;
  hookSpoolDir?: string;
  socketPath?: string;
  stateDir?: string;
  diagnosticsDir?: string;
  logPaths?: string[];
  logger?: JsonlLogger;
  config?: WosmConfig;
  configPath?: string;
  configDiagnostics?: ConfigDiagnostic[];
  metadataRefresh?: WorktreeMetadataRefreshService;
  onStop?: () => Promise<void> | void;
  hookReconcileDebounceMs?: number;
};

export type ObserverApi = ProtocolObserverApi;

export function createObserverApi(options: CreateObserverApiOptions): ObserverApi {
  const clock = options.clock ?? systemClock;
  let reconciling = false;
  const schedulerOptions: CreateReconcileSchedulerOptions = {
    reconcile: (reason) => runReconcile(reason),
  };
  if (options.hookReconcileDebounceMs !== undefined) {
    schedulerOptions.debounceMs = options.hookReconcileDebounceMs;
  }
  if (options.logger !== undefined) {
    schedulerOptions.onError = async (error) => {
      await options.logger?.error("Scheduled observer reconcile failed.", { error });
    };
  }
  const reconcileScheduler = createReconcileScheduler(schedulerOptions);
  let defaultMetadataRefresh: WorktreeMetadataRefreshService | undefined;
  if (options.metadataRefresh === undefined && options.config !== undefined) {
    const metadataRefreshOptions: Parameters<typeof createWorktreeMetadataRefreshService>[0] = {
      projects: providerProjectsFromConfig(options.config),
      persistence: options.persistence,
      requestReconcile: reconcileScheduler.request,
      clock,
    };
    if (options.logger !== undefined) {
      metadataRefreshOptions.logger = options.logger;
    }
    if (options.providers !== undefined) {
      metadataRefreshOptions.repositoryProviders = options.providers.repositories;
    }
    defaultMetadataRefresh = createWorktreeMetadataRefreshService(metadataRefreshOptions);
  }
  const metadataRefresh = options.metadataRefresh ?? defaultMetadataRefresh;
  const hookIngestion =
    options.hookIngestion ??
    createHookIngestion({
      persistence: options.persistence,
      ...(options.providers === undefined ? {} : { providers: options.providers }),
      projects: providerProjectsFromConfig(options.config ?? emptyConfig()),
      eventBus: options.eventBus,
      clock,
      ...(options.config?.observability?.retention === undefined
        ? {}
        : { retention: options.config.observability.retention }),
      requestReconcile: reconcileScheduler.request,
    });
  const harnessEventReportIngestion =
    options.harnessEventReportIngestion ??
    createHarnessEventReportIngestion({
      persistence: options.persistence,
      eventBus: options.eventBus,
      clock,
      ...(options.config?.observability?.retention === undefined
        ? {}
        : { retention: options.config.observability.retention }),
      requestReconcile: reconcileScheduler.request,
    });

  const api: ObserverApi = {
    health: async () => {
      const coreHealth = options.core.getHealth();
      const snapshot = options.core.getSnapshot();
      const spoolDepth =
        options.hookSpoolDir === undefined ? undefined : await hookSpoolDepth(options.hookSpoolDir);

      const health: ObserverHealth = {
        schemaVersion: WOSM_SCHEMA_VERSION,
        status: coreHealth.status,
        pid: snapshot.observer.pid,
        startedAt: coreHealth.startedAt,
        version: snapshot.observer.version,
        uptimeMs: Math.max(
          0,
          Date.parse(toIsoTimestamp(clock.now())) - Date.parse(coreHealth.startedAt),
        ),
        providerHealth: coreHealth.providerHealth,
      };
      if (options.socketPath !== undefined) health.socketPath = options.socketPath;
      if (options.stateDir !== undefined) health.stateDir = options.stateDir;
      if (spoolDepth !== undefined) health.hookSpoolDepth = spoolDepth;
      if (coreHealth.sqlite !== undefined) health.sqlite = coreHealth.sqlite;
      if (coreHealth.lastReconcile !== undefined) health.lastReconcile = coreHealth.lastReconcile;
      return health;
    },
    stop: async (): Promise<ObserverStopReceipt> => {
      await metadataRefresh?.shutdown?.();
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
    reconcile: runReconcile,
    ingestHookEvent: (event: ProviderHookEvent): Promise<HookReceipt> =>
      hookIngestion.ingest(event),
    reportHarnessEvent: async (report: HarnessEventReport): Promise<HarnessEventReportReceipt> => {
      const receipt = await harnessEventReportIngestion.ingest(report, {
        triggerReconcile: false,
      });
      if (!receipt.accepted || receipt.deduped === true) {
        return receipt;
      }
      const projection = await runRuntimeBoundary(
        {
          operation: "observer.harnessEventReport.projectStatus",
          clock,
          error: {
            tag: "StatusProjectionError",
            code: "STATUS_PROJECTION_FAILED",
            message: "Observer could not project the harness event status.",
            provider: report.provider,
          },
        },
        () => options.core.projectHarnessEventStatus(report),
      );
      if (!projection.ok) {
        await options.logger?.error("Harness event status projection failed.", {
          provider: report.provider,
          reportId: report.reportId,
          error: projection.error,
        });
        reconcileScheduler.request(`harness-report:${report.provider}:${report.eventType}`);
        return HarnessEventReportReceiptSchema.parse({
          ...receipt,
          projected: false,
          scheduledReconcile: true,
          error: projection.error,
        });
      }
      for (const event of projection.value.events) {
        options.eventBus.publish(event);
      }
      reconcileScheduler.request(`harness-report:${report.provider}:${report.eventType}`);
      return HarnessEventReportReceiptSchema.parse({
        ...receipt,
        projected: projection.value.projected,
        scheduledReconcile: true,
      });
    },
  };

  async function runReconcile(reason = "manual"): Promise<ReconcileReceipt> {
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
    if (metadataRefresh !== undefined) {
      void metadataRefresh.refresh(result.value).catch(async (error: unknown) => {
        await options.logger?.error("Worktree metadata refresh failed.", { error });
      });
    }
    return {
      schemaVersion: WOSM_SCHEMA_VERSION,
      reason,
      reconciledAt: result.value.generatedAt,
      snapshot: result.value,
    };
  }

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
          report: (report) =>
            harnessEventReportIngestion.ingest(report, { triggerReconcile: false }),
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
      diagnosticsDir: options.diagnosticsDir ?? `${stateDir}/diagnostics`,
    };
    if (options.socketPath !== undefined) paths.socketPath = options.socketPath;
    if (options.hookSpoolDir !== undefined) paths.hookSpoolDir = options.hookSpoolDir;
    if (options.logPaths !== undefined) paths.logPaths = options.logPaths;

    const deps: ObserverDiagnosticsDeps = {
      config: options.config ?? emptyConfig(),
      core: options.core,
      persistence: options.persistence,
      paths,
      clock,
    };
    if (options.configPath !== undefined) deps.configPath = options.configPath;
    if (options.configDiagnostics !== undefined) {
      deps.configDiagnostics = options.configDiagnostics;
    }
    if (options.providers !== undefined) deps.providers = options.providers;
    return deps;
  }
}

function toCommandRecord(command: PersistedCommand): CommandRecord {
  const record: CommandRecord = {
    id: command.id,
    type: command.type,
    command: command.command,
    status: command.status,
    createdAt: command.createdAt,
  };
  if (command.startedAt !== undefined) record.startedAt = command.startedAt;
  if (command.finishedAt !== undefined) record.finishedAt = command.finishedAt;
  if (command.traceId !== undefined) record.traceId = command.traceId;
  if (command.spanId !== undefined) record.spanId = command.spanId;
  if (command.error !== undefined) record.error = command.error;
  return record;
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
