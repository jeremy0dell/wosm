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
  ObserverHealth,
  ObserverStopReceipt,
  ProviderHookEvent,
  ProviderHookReceipt,
  ReconcileReceipt,
  WosmCommand,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";
import { HarnessEventReportReceiptSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import type { ObserverApi } from "@wosm/protocol";
import { type RuntimeClock, runRuntimeBoundary, systemClock, toIsoTimestamp } from "@wosm/runtime";
import type { CommandQueue } from "../commands/queue.js";
import { commandRecordFromPersisted } from "../commands/record.js";
import {
  collectDiagnosticSnapshot,
  type DiagnosticRuntimePaths,
  type ObserverDiagnosticsDeps,
  runDoctor,
} from "../diagnostics/collector.js";
import {
  createHarnessIngressQueue,
  type HarnessIngressProcessResult,
  type HarnessIngressQueue,
} from "../hooks/harnessIngressQueue.js";
import {
  createHarnessEventReportIngestion,
  createProviderHookIngress,
  type HarnessEventReportIngestion,
  type ProviderHookIngress,
} from "../hooks/ingestion.js";
import { drainProviderIngressSpool, providerIngressSpoolDepth } from "../hooks/spool.js";
import {
  createWorktreeMetadataRefreshService,
  type WorktreeMetadataRefreshService,
} from "../metadata/refresh.js";
import type { ObserverPersistence } from "../persistence/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { type ObserverCore, providerProjectsFromConfig } from "../reconcile/core.js";
import { emptyConfig } from "./emptyConfig.js";
import type { ObserverEventBus } from "./eventBus.js";
import {
  type CreateReconcileSchedulerOptions,
  createReconcileScheduler,
  type ReconcileSchedulerFlushProfile,
} from "./reconcileScheduler.js";

type ReconcileProfile = {
  reason: string;
  totalMs: number;
  drainMs: number;
  coreReconcileMs: number;
  publishMs: number;
  metadataRefreshScheduled: boolean;
  rows: number;
  projectsScanned: number;
};

const profileSlowReconcileMs = 1000;
const profileLargeQueueCount = 25;

export type CreateObserverApiOptions = {
  core: ObserverCore;
  providers?: ProviderRegistry;
  persistence: ObserverPersistence;
  commandQueue: CommandQueue;
  eventBus: ObserverEventBus;
  clock?: RuntimeClock;
  providerHookIngress?: ProviderHookIngress;
  harnessEventReportIngestion?: HarnessEventReportIngestion;
  harnessIngressQueue?: HarnessIngressQueue;
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
    schedulerOptions.onFlushFinish = async (profile) => {
      await logReconcileSchedulerProfile(options.logger, profile);
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
      watchGitRefs: true,
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
  const providerHookIngress =
    options.providerHookIngress ??
    createProviderHookIngress({
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
  const harnessIngressQueue =
    options.harnessIngressQueue ??
    createHarnessIngressQueue({
      clock,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      requestReconcile: reconcileScheduler.request,
      processReport: processHarnessIngressReport,
    });
  let configuredSpoolDrain: Promise<void> | undefined;

  const api: ObserverApi = {
    health: async () => {
      const coreHealth = options.core.getHealth();
      const snapshot = options.core.getSnapshot();
      const spoolDepth =
        options.hookSpoolDir === undefined
          ? undefined
          : await providerIngressSpoolDepth(options.hookSpoolDir);

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
      health.harnessIngressQueue = harnessIngressQueue.health();
      if (coreHealth.sqlite !== undefined) health.sqlite = coreHealth.sqlite;
      if (coreHealth.lastReconcile !== undefined) health.lastReconcile = coreHealth.lastReconcile;
      return health;
    },
    stop: async (): Promise<ObserverStopReceipt> => {
      await harnessIngressQueue.shutdown();
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
      return command === undefined ? undefined : commandRecordFromPersisted(command);
    },
    runDoctor: async (doctorOptions?: DoctorOptions): Promise<DoctorReport> =>
      runDoctor(diagnosticDeps(), doctorOptions),
    collectDiagnostics: async (
      diagnosticOptions?: DiagnosticCollectionOptions,
    ): Promise<DiagnosticSnapshot> =>
      collectDiagnosticSnapshot(diagnosticDeps(), diagnosticOptions),
    reconcile: runReconcile,
    ingestProviderHookEvent: (event: ProviderHookEvent): Promise<ProviderHookReceipt> =>
      providerHookIngress.ingest(event),
    ingestHookEvent: (event: ProviderHookEvent): Promise<ProviderHookReceipt> =>
      providerHookIngress.ingest(event),
    reportHarnessEvent: async (report: HarnessEventReport): Promise<HarnessEventReportReceipt> =>
      harnessIngressQueue.enqueue(report),
  };

  async function runReconcile(reason = "manual"): Promise<ReconcileReceipt> {
    const profileStartedAt = Date.now();
    let drainMs = 0;
    let coreReconcileMs = 0;
    let publishMs = 0;
    let metadataRefreshScheduled = false;
    if (!reconciling) {
      if (reason === "observer.startup") {
        void drainConfiguredSpoolAndQueue().catch(async (error: unknown) => {
          await options.logger?.error("Startup hook spool drain failed.", { error });
        });
      } else {
        reconciling = true;
        const drainStartedAt = Date.now();
        try {
          await drainConfiguredSpoolAndQueue();
        } finally {
          drainMs = elapsedMs(drainStartedAt);
          reconciling = false;
        }
      }
    }

    const previousSnapshot = options.core.getSnapshot();
    const coreReconcileStartedAt = Date.now();
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
    coreReconcileMs = elapsedMs(coreReconcileStartedAt);

    if (!result.ok) {
      throw result.error;
    }

    const publishStartedAt = Date.now();
    const event: WosmEvent = {
      type: "observer.reconciled",
      at: result.value.generatedAt,
      changed: 0,
    };
    for (const agentEvent of agentStateChangedEventsFromReconcile(previousSnapshot, result.value)) {
      options.eventBus.publish(agentEvent);
    }
    options.eventBus.publish(event);
    publishMs = elapsedMs(publishStartedAt);
    if (metadataRefresh !== undefined) {
      metadataRefreshScheduled = true;
      void metadataRefresh.refresh(result.value).catch(async (error: unknown) => {
        await options.logger?.error("Worktree metadata refresh failed.", { error });
      });
    }
    await logReconcileProfile(options.logger, {
      reason,
      totalMs: elapsedMs(profileStartedAt),
      drainMs,
      coreReconcileMs,
      publishMs,
      metadataRefreshScheduled,
      rows: result.value.rows.length,
      projectsScanned: result.value.projects.length,
    });
    return {
      schemaVersion: WOSM_SCHEMA_VERSION,
      reason,
      reconciledAt: result.value.generatedAt,
      snapshot: result.value,
    };
  }

  async function drainConfiguredSpoolAndQueue(): Promise<void> {
    await drainConfiguredSpool();
    await harnessIngressQueue.drain();
  }

  async function drainConfiguredSpool(): Promise<void> {
    if (options.hookSpoolDir === undefined) {
      return;
    }
    if (configuredSpoolDrain !== undefined) {
      await configuredSpoolDrain;
      return;
    }
    const spoolDir = options.hookSpoolDir;

    configuredSpoolDrain = runRuntimeBoundary(
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
        drainProviderIngressSpool({
          spoolDir,
          persistence: options.persistence,
          eventBus: options.eventBus,
          clock,
          ingest: (event) => providerHookIngress.ingest(event, { triggerReconcile: false }),
          report: async (report) => {
            const result = await processHarnessIngressReportInner(report);
            if (result.reconcileReason !== undefined) {
              reconcileScheduler.request(result.reconcileReason);
            }
            return result.receipt;
          },
        }),
    )
      .then((result) => {
        if (!result.ok) {
          throw result.error;
        }
        harnessIngressQueue.recordSpoolDrain(result.value);
      })
      .finally(() => {
        configuredSpoolDrain = undefined;
      });

    await configuredSpoolDrain;
  }

  function processHarnessIngressReport(
    report: HarnessEventReport,
  ): Promise<HarnessIngressProcessResult> {
    return processHarnessIngressReportInner(report);
  }

  async function processHarnessIngressReportInner(
    report: HarnessEventReport,
  ): Promise<HarnessIngressProcessResult> {
    const receipt = await harnessEventReportIngestion.ingest(report, {
      triggerReconcile: false,
    });
    if (!receipt.accepted || receipt.deduped === true) {
      return { receipt };
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
      return {
        receipt: HarnessEventReportReceiptSchema.parse({
          ...receipt,
          projected: false,
          scheduledReconcile: true,
          error: projection.error,
        }),
        reconcileReason: `harness-report:${report.provider}:${report.eventType}`,
      };
    }
    for (const event of projection.value.events) {
      options.eventBus.publish(event);
    }
    return {
      receipt: HarnessEventReportReceiptSchema.parse({
        ...receipt,
        projected: projection.value.projected,
        scheduledReconcile: true,
      }),
      reconcileReason: `harness-report:${report.provider}:${report.eventType}`,
    };
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

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

async function logReconcileSchedulerProfile(
  logger: JsonlLogger | undefined,
  profile: ReconcileSchedulerFlushProfile,
): Promise<void> {
  if (
    profile.durationMs < profileSlowReconcileMs &&
    profile.queuedCount < profileLargeQueueCount &&
    profile.queuedWhileRunning === 0
  ) {
    return;
  }
  await logger?.info("Reconcile scheduler profile.", profile);
}

async function logReconcileProfile(
  logger: JsonlLogger | undefined,
  profile: ReconcileProfile,
): Promise<void> {
  if (profile.totalMs < profileSlowReconcileMs) {
    return;
  }
  await logger?.info("Reconcile profile.", profile);
}

export function agentStateChangedEventsFromReconcile(
  before: WosmSnapshot,
  after: WosmSnapshot,
): WosmEvent[] {
  const previousAgents = new Map(before.rows.map((row) => [row.id, row.agent]));
  const events: WosmEvent[] = [];
  for (const row of after.rows) {
    const previous = previousAgents.get(row.id);
    if (!agentStateChanged(previous, row.agent)) {
      continue;
    }
    const event: WosmEvent = {
      type: "worktree.agentStateChanged",
      worktreeId: row.id,
    };
    if (row.agent !== undefined) event.agent = row.agent;
    events.push(event);
  }
  return events;
}

function agentStateChanged(
  left: WosmSnapshot["rows"][number]["agent"],
  right: WosmSnapshot["rows"][number]["agent"],
): boolean {
  return left !== undefined && left.state !== right?.state;
}
