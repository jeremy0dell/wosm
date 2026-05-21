import type { WosmConfig } from "@wosm/config";
import type {
  HarnessCapabilities,
  HarnessRunObservation,
  ProviderHealth,
  ProviderId,
  ProviderProjectConfig,
  SafeError,
  TerminalTargetObservation,
  WorktreeObservation,
  WosmSnapshot,
} from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import {
  durationMs,
  type RuntimeClock,
  runRuntimeBoundaryWithRetryAndTimeout,
  safeErrorFromUnknown,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import { buildWosmSnapshot, safeErrorToProviderHealth } from "./graph.js";
import type { ObserverPersistence } from "./persistence/index.js";
import type { ProviderRegistry } from "./providerRegistry.js";
import type { ObserverSqliteHandle, ObserverSqliteHealth } from "./sqlite.js";

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
  const projects = providerProjectsFromConfig(input.config);
  let reconcileChain: Promise<void> = Promise.resolve();
  let providerHealth: Record<string, ProviderHealth> = {};
  let lastReconcile: ReconcileTiming | undefined;
  let snapshot = buildWosmSnapshot({
    generatedAt: startedAt,
    observer: {
      pid,
      startedAt,
      version,
      healthy: true,
    },
    projects,
    worktreeProviderId: input.providers.worktree.id,
    providerHealth,
    worktrees: [],
    terminalTargets: [],
    harnessRuns: [],
  });

  return {
    reconcile: async (reason = "manual") => {
      const run = async () => {
        const started = toIsoTimestamp(clock.now());
        await input.logger?.info("Reconcile started.", { reason });
        const errors: SafeError[] = [];
        const worktrees: WorktreeObservation[] = [];
        let terminalTargets: TerminalTargetObservation[] = [];
        let harnessRuns: HarnessRunObservation[] = [];
        const harnessCapabilities: Record<string, HarnessCapabilities> = {};
        providerHealth = {};

        providerHealth[input.providers.worktree.id] = await readProviderHealth({
          providerId: input.providers.worktree.id,
          providerType: "worktree",
          capabilities: input.providers.worktree.capabilities(),
          clock,
          timeoutMs: providerTimeoutMs,
          retries: providerReadRetries,
          health: () => input.providers.worktree.health(),
          errors,
        });

        let projectsScanned = 0;
        for (const project of projects) {
          const result = await runProviderReadBoundary(
            {
              operation: `provider.${input.providers.worktree.id}.listWorktrees`,
              clock,
              timeoutMs: providerTimeoutMs,
              retries: providerReadRetries,
              error: {
                tag: "WorktreeProviderError",
                code: "WORKTREE_LIST_FAILED",
                message: "The worktree provider failed to list worktrees.",
                provider: input.providers.worktree.id,
              },
            },
            () => input.providers.worktree.listWorktrees(project),
          );
          if (!result.ok) {
            errors.push(result.error);
            await input.logger?.error("Worktree provider list failed.", {
              provider: input.providers.worktree.id,
              error: result.error,
              durationMs: result.timing.durationMs,
            });
            providerHealth[input.providers.worktree.id] = failedProviderHealth({
              providerId: input.providers.worktree.id,
              providerType: "worktree",
              lastCheckedAt: result.timing.finishedAt,
              lastError: result.error,
              latencyMs: result.timing.durationMs,
              capabilities: input.providers.worktree.capabilities(),
            });
            break;
          }
          projectsScanned += 1;
          worktrees.push(...result.value);
        }

        providerHealth[input.providers.terminal.id] = await readProviderHealth({
          providerId: input.providers.terminal.id,
          providerType: "terminal",
          capabilities: input.providers.terminal.capabilities(),
          clock,
          timeoutMs: providerTimeoutMs,
          retries: providerReadRetries,
          health: () => input.providers.terminal.health(),
          errors,
        });

        const terminalResult = await runProviderReadBoundary(
          {
            operation: `provider.${input.providers.terminal.id}.listTargets`,
            clock,
            timeoutMs: providerTimeoutMs,
            retries: providerReadRetries,
            error: {
              tag: "TerminalProviderError",
              code: "TERMINAL_LIST_FAILED",
              message: "The terminal provider failed to list targets.",
              provider: input.providers.terminal.id,
            },
          },
          () => input.providers.terminal.listTargets(),
        );
        if (terminalResult.ok) {
          terminalTargets = terminalResult.value;
        } else {
          errors.push(terminalResult.error);
          await input.logger?.error("Terminal provider list failed.", {
            provider: input.providers.terminal.id,
            error: terminalResult.error,
            durationMs: terminalResult.timing.durationMs,
          });
          providerHealth[input.providers.terminal.id] = failedProviderHealth({
            providerId: input.providers.terminal.id,
            providerType: "terminal",
            lastCheckedAt: terminalResult.timing.finishedAt,
            lastError: terminalResult.error,
            latencyMs: terminalResult.timing.durationMs,
            capabilities: input.providers.terminal.capabilities(),
          });
        }

        for (const provider of input.providers.harnesses.values()) {
          const capabilities = provider.capabilities();
          harnessCapabilities[provider.id] = capabilities;
          providerHealth[provider.id] = await readProviderHealth({
            providerId: provider.id,
            providerType: "harness",
            capabilities,
            clock,
            timeoutMs: providerTimeoutMs,
            retries: providerReadRetries,
            health: () => provider.health(),
            errors,
          });

          const result = await runProviderReadBoundary(
            {
              operation: `provider.${provider.id}.discoverRuns`,
              clock,
              timeoutMs: providerTimeoutMs,
              retries: providerReadRetries,
              error: {
                tag: "HarnessProviderError",
                code: "HARNESS_DISCOVER_FAILED",
                message: "The harness provider failed to discover runs.",
                provider: provider.id,
              },
            },
            () =>
              provider.discoverRuns({
                projects,
                worktrees,
                terminalTargets,
              }),
          );

          if (result.ok) {
            harnessRuns = [...harnessRuns, ...result.value];
          } else {
            errors.push(result.error);
            await input.logger?.error("Harness provider discovery failed.", {
              provider: provider.id,
              error: result.error,
              durationMs: result.timing.durationMs,
            });
            providerHealth[provider.id] = failedProviderHealth({
              providerId: provider.id,
              providerType: "harness",
              lastCheckedAt: result.timing.finishedAt,
              lastError: result.error,
              latencyMs: result.timing.durationMs,
              capabilities,
            });
          }
        }

        const finishedAt = toIsoTimestamp(clock.now());
        lastReconcile = {
          reason,
          startedAt: started,
          finishedAt,
          durationMs: durationMs(started, finishedAt),
          projectsScanned,
          worktreesObserved: worktrees.length,
          terminalTargetsObserved: terminalTargets.length,
          harnessRunsObserved: harnessRuns.length,
          eventsEmitted: 0,
          errors,
        };
        snapshot = buildWosmSnapshot({
          generatedAt: finishedAt,
          observer: {
            pid,
            startedAt,
            version,
          },
          projects,
          worktreeProviderId: input.providers.worktree.id,
          providerHealth,
          harnessCapabilities,
          worktrees,
          terminalTargets,
          harnessRuns,
        });

        if (input.persistence !== undefined) {
          await input.persistence.persistReconcileResult({
            projects,
            worktrees,
            terminalTargets,
            harnessRuns,
            providerHealth,
            observedAt: finishedAt,
          });
          await input.persistence.recordEvent(
            {
              type: "observer.reconciled",
              at: finishedAt,
              changed: 0,
            },
            { createdAt: finishedAt },
          );
          lastReconcile.eventsEmitted = 1;
        }

        await input.logger?.info("Reconcile finished.", {
          reason,
          durationMs: lastReconcile.durationMs,
          projectsScanned,
          worktreesObserved: worktrees.length,
          terminalTargetsObserved: terminalTargets.length,
          harnessRunsObserved: harnessRuns.length,
          errorCount: errors.length,
        });

        return snapshot;
      };

      const previous = reconcileChain;
      const execution = previous.then(run);
      reconcileChain = execution.catch(() => undefined).then(() => undefined);
      return execution;
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
  return config.projects.map((project) => ({
    id: project.id,
    label: project.label,
    root: project.root,
    defaults: project.defaults,
    worktrunk: {
      enabled: project.worktrunk.enabled,
      ...(project.worktrunk.base === undefined ? {} : { base: project.worktrunk.base }),
    },
    ...(project.recoveryBreadcrumbs === undefined
      ? {}
      : {
          recoveryBreadcrumbs: {
            location: project.recoveryBreadcrumbs.location,
            ...(project.recoveryBreadcrumbs.path === undefined
              ? {}
              : { path: project.recoveryBreadcrumbs.path }),
          },
        }),
  }));
}

async function readProviderHealth(input: {
  providerId: ProviderId;
  providerType: ProviderHealth["providerType"];
  capabilities: Record<string, boolean>;
  clock: RuntimeClock;
  timeoutMs: number;
  retries: number;
  health: () => Promise<ProviderHealth>;
  errors: SafeError[];
}): Promise<ProviderHealth> {
  const result = await runProviderReadBoundary(
    {
      operation: `provider.${input.providerId}.health`,
      clock: input.clock,
      timeoutMs: input.timeoutMs,
      retries: input.retries,
      error: {
        tag: "ProviderUnavailableError",
        code: "PROVIDER_HEALTH_FAILED",
        message: "The provider health check failed.",
        provider: input.providerId,
      },
    },
    input.health,
  );

  if (result.ok) {
    return {
      ...result.value,
      latencyMs: result.value.latencyMs ?? result.timing.durationMs,
      capabilities: result.value.capabilities ?? input.capabilities,
    };
  }

  input.errors.push(result.error);
  return failedProviderHealth({
    providerId: input.providerId,
    providerType: input.providerType,
    lastCheckedAt: result.timing.finishedAt,
    lastError: result.error,
    latencyMs: result.timing.durationMs,
    capabilities: input.capabilities,
  });
}

function runProviderReadBoundary<T>(
  input: {
    operation: string;
    clock: RuntimeClock;
    timeoutMs: number;
    retries: number;
    error: {
      tag: string;
      code: string;
      message: string;
      provider: string;
    };
  },
  task: () => Promise<T>,
) {
  return runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: input.operation,
      clock: input.clock,
      timeoutMs: input.timeoutMs,
      error: input.error,
      timeoutError: {
        tag: "TimeoutError",
        code: "PROVIDER_TIMEOUT",
        message: "Provider operation timed out.",
        provider: input.error.provider,
      },
      retry: {
        retries: input.retries,
        delayMs: 10,
      },
    },
    task,
  );
}

function failedProviderHealth(input: {
  providerId: ProviderId;
  providerType: ProviderHealth["providerType"];
  lastCheckedAt: string;
  lastError: SafeError;
  latencyMs: number;
  capabilities: Record<string, boolean>;
}): ProviderHealth {
  return safeErrorToProviderHealth({
    providerId: input.providerId,
    providerType: input.providerType,
    lastCheckedAt: input.lastCheckedAt,
    lastError: safeErrorFromUnknown(input.lastError, {
      tag: input.lastError.tag,
      code: input.lastError.code,
      message: input.lastError.message,
      provider: input.providerId,
    }),
    latencyMs: input.latencyMs,
    capabilities: input.capabilities,
  });
}
