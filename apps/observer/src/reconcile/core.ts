import type { WosmConfig } from "@wosm/config";
import type {
  HarnessEventReport,
  ProviderHealth,
  ProviderProjectConfig,
  SafeError,
  WosmSnapshot,
} from "@wosm/contracts";
import { ProviderProjectConfigSchema } from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import { type RuntimeClock, systemClock, toIsoTimestamp } from "@wosm/runtime";
import type { ObserverPersistence } from "../persistence/index.js";
import { providerObservationRetentionDays } from "../persistence/retention.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ObserverSqliteHandle, ObserverSqliteHealth } from "../sqlite.js";
import { buildInitialSnapshot, type ProviderReadOptions, runReconcileOnce } from "./run.js";
import {
  projectHarnessEventReportOntoSnapshot,
  type StatusProjectionResult,
} from "./statusProjection.js";

export type ReconcileTiming = {
  reason: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  projectsScanned: number;
  worktreesObserved: number;
  terminalTargetsObserved: number;
  harnessRunsObserved: number;
  eventsEmitted: number;
  errors: SafeError[];
};

export type ObserverCoreHealth = {
  status: "healthy" | "degraded";
  startedAt: string;
  providerHealth: Record<string, ProviderHealth>;
  sqlite?: ObserverSqliteHealth;
  lastReconcile?: ReconcileTiming;
};

export type ObserverCore = {
  reconcile(reason?: string): Promise<WosmSnapshot>;
  projectHarnessEventStatus(report: HarnessEventReport): Promise<StatusProjectionResult>;
  getSnapshot(): WosmSnapshot;
  getHealth(): ObserverCoreHealth;
};

export type CreateObserverCoreInput = {
  config: WosmConfig;
  providers: ProviderRegistry;
  clock?: RuntimeClock;
  sqlite?: ObserverSqliteHandle;
  persistence?: ObserverPersistence;
  logger?: JsonlLogger;
  pid?: number;
  version?: string;
  providerTimeoutMs?: number;
  providerReadRetries?: number;
};

export function createObserverCore(input: CreateObserverCoreInput): ObserverCore {
  const clock = input.clock ?? systemClock;
  const startedAt = toIsoTimestamp(clock.now());
  const pid = input.pid ?? process.pid;
  const version = input.version ?? "0.0.0";
  const providerTimeoutMs = input.providerTimeoutMs ?? 5000;
  const providerReadRetries = input.providerReadRetries ?? 1;
  const retentionDays = providerObservationRetentionDays(input.config.observability?.retention);
  const projects = providerProjectsFromConfig(input.config);
  let reconcileChain: Promise<void> = Promise.resolve();
  let providerHealth: Record<string, ProviderHealth> = {};
  let lastReconcile: ReconcileTiming | undefined;
  let snapshot = buildInitialSnapshot({
    generatedAt: startedAt,
    observer: { pid, startedAt, version },
    projects,
    worktreeProviderId: input.providers.worktree.id,
  });

  const read: ProviderReadOptions = {
    clock,
    timeoutMs: providerTimeoutMs,
    retries: providerReadRetries,
    ...(input.logger === undefined ? {} : { logger: input.logger }),
  };
  const observer = { pid, startedAt, version };

  return {
    reconcile: async (reason = "manual") => {
      const run = async (): Promise<WosmSnapshot> => {
        const result = await runReconcileOnce({
          reason,
          observer,
          projects,
          providers: input.providers,
          read,
          ...(input.persistence === undefined ? {} : { persistence: input.persistence }),
          providerObservationRetentionDays: retentionDays,
        });
        providerHealth = result.providerHealth;
        lastReconcile = result.lastReconcile;
        snapshot = result.snapshot;
        return snapshot;
      };

      const previous = reconcileChain;
      const execution = previous.then(run);
      reconcileChain = execution.catch(() => undefined).then(() => undefined);
      return execution;
    },
    projectHarnessEventStatus: async (report) => {
      const result = projectHarnessEventReportOntoSnapshot({
        snapshot,
        report,
        projectedAt: toIsoTimestamp(clock.now()),
      });
      if (result.projected) {
        snapshot = result.snapshot;
      }
      return result;
    },
    getSnapshot: () => snapshot,
    getHealth: () => ({
      status: snapshot.observer.healthy ? "healthy" : "degraded",
      startedAt,
      providerHealth,
      ...(input.sqlite === undefined ? {} : { sqlite: input.sqlite.health() }),
      ...(lastReconcile === undefined ? {} : { lastReconcile }),
    }),
  };
}

export function providerProjectsFromConfig(config: WosmConfig): ProviderProjectConfig[] {
  return config.projects.map((project) => {
    const providerProject: ProviderProjectConfig = {
      id: project.id,
      label: project.label,
      root: project.root,
      ...(project.defaultBranch === undefined ? {} : { defaultBranch: project.defaultBranch }),
      defaults: project.defaults,
      worktrunk: {
        enabled: project.worktrunk.enabled,
      },
    };
    if (project.worktrunk.base !== undefined) {
      providerProject.worktrunk.base = project.worktrunk.base;
    }
    if (project.worktrunk.managedRoot !== undefined) {
      providerProject.worktrunk.managedRoot = project.worktrunk.managedRoot;
    }
    if (project.worktrunk.includeMain !== undefined) {
      providerProject.worktrunk.includeMain = project.worktrunk.includeMain;
    }
    if (project.worktrunk.includeExternal !== undefined) {
      providerProject.worktrunk.includeExternal = project.worktrunk.includeExternal;
    }
    if (project.recoveryBreadcrumbs !== undefined) {
      providerProject.recoveryBreadcrumbs = {
        location: project.recoveryBreadcrumbs.location,
      };
      if (project.recoveryBreadcrumbs.path !== undefined) {
        providerProject.recoveryBreadcrumbs.path = project.recoveryBreadcrumbs.path;
      }
    }
    return ProviderProjectConfigSchema.parse(providerProject);
  });
}
