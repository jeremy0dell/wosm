import type {
  HarnessCapabilities,
  HarnessEventObservation,
  HarnessProvider,
  HarnessRunObservation,
  HarnessStatusObservation,
  ProviderHealth,
  ProviderId,
  ProviderProjectConfig,
  SafeError,
  TerminalTargetObservation,
  WorktreeObservation,
  WosmSnapshot,
} from "@wosm/contracts";
import { HarnessEventObservationSchema } from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import {
  durationMs,
  type RuntimeClock,
  runRuntimeBoundaryWithRetryAndTimeout,
  safeErrorFromUnknown,
  toIsoTimestamp,
} from "@wosm/runtime";
import type { ObserverPersistence } from "../persistence/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ReconcileTiming } from "./core.js";
import { buildWosmSnapshot, safeErrorToProviderHealth } from "./graph.js";

export type ProviderReadOptions = {
  clock: RuntimeClock;
  timeoutMs: number;
  retries: number;
  logger?: JsonlLogger;
};

export type ReconcileOnceInput = {
  reason: string;
  observer: {
    pid: number;
    startedAt: string;
    version: string;
  };
  projects: ProviderProjectConfig[];
  providers: ProviderRegistry;
  read: ProviderReadOptions;
  persistence?: ObserverPersistence;
};

export type ReconcileOnceResult = {
  snapshot: WosmSnapshot;
  providerHealth: Record<string, ProviderHealth>;
  lastReconcile: ReconcileTiming;
};

export function buildInitialSnapshot(input: {
  generatedAt: string;
  observer: {
    pid: number;
    startedAt: string;
    version: string;
  };
  projects: ProviderProjectConfig[];
  worktreeProviderId: ProviderId;
}): WosmSnapshot {
  return buildWosmSnapshot({
    generatedAt: input.generatedAt,
    observer: {
      ...input.observer,
      healthy: true,
    },
    projects: input.projects,
    worktreeProviderId: input.worktreeProviderId,
    providerHealth: {},
    worktrees: [],
    terminalTargets: [],
    harnessRuns: [],
  });
}

export async function runReconcileOnce(input: ReconcileOnceInput): Promise<ReconcileOnceResult> {
  const started = toIsoTimestamp(input.read.clock.now());
  await input.read.logger?.info("Reconcile started.", { reason: input.reason });
  const errors: SafeError[] = [];
  const providerHealth: Record<string, ProviderHealth> = {};

  const worktreeResult = await readWorktreeObservations({
    providers: input.providers,
    projects: input.projects,
    read: input.read,
    providerHealth,
    errors,
  });
  const terminalResult = await readTerminalTargetObservations({
    providers: input.providers,
    read: input.read,
    providerHealth,
    errors,
  });
  const harnessResult = await readHarnessObservations({
    providers: input.providers,
    projects: input.projects,
    worktrees: worktreeResult.worktrees,
    terminalTargets: terminalResult.terminalTargets,
    read: input.read,
    providerHealth,
    errors,
    ...(input.persistence === undefined ? {} : { persistence: input.persistence }),
  });

  const finishedAt = toIsoTimestamp(input.read.clock.now());
  const lastReconcile: ReconcileTiming = {
    reason: input.reason,
    startedAt: started,
    finishedAt,
    durationMs: durationMs(started, finishedAt),
    projectsScanned: worktreeResult.projectsScanned,
    worktreesObserved: worktreeResult.worktrees.length,
    terminalTargetsObserved: terminalResult.terminalTargets.length,
    harnessRunsObserved: harnessResult.harnessRuns.length,
    eventsEmitted: 0,
    errors,
  };
  const snapshot = buildWosmSnapshot({
    generatedAt: finishedAt,
    observer: input.observer,
    projects: input.projects,
    worktreeProviderId: input.providers.worktree.id,
    providerHealth,
    harnessCapabilities: harnessResult.harnessCapabilities,
    worktrees: worktreeResult.worktrees,
    terminalTargets: terminalResult.terminalTargets,
    harnessRuns: harnessResult.harnessRuns,
  });

  lastReconcile.eventsEmitted = await persistReconcileResult({
    ...(input.persistence === undefined ? {} : { persistence: input.persistence }),
    projects: input.projects,
    worktrees: worktreeResult.worktrees,
    terminalTargets: terminalResult.terminalTargets,
    harnessRuns: harnessResult.harnessRuns,
    providerHealth,
    observedAt: finishedAt,
  });

  await input.read.logger?.info("Reconcile finished.", {
    reason: input.reason,
    durationMs: lastReconcile.durationMs,
    projectsScanned: worktreeResult.projectsScanned,
    worktreesObserved: worktreeResult.worktrees.length,
    terminalTargetsObserved: terminalResult.terminalTargets.length,
    harnessRunsObserved: harnessResult.harnessRuns.length,
    errorCount: errors.length,
  });

  return {
    snapshot,
    providerHealth,
    lastReconcile,
  };
}

async function readWorktreeObservations(input: {
  providers: ProviderRegistry;
  projects: ProviderProjectConfig[];
  read: ProviderReadOptions;
  providerHealth: Record<string, ProviderHealth>;
  errors: SafeError[];
}): Promise<{
  worktrees: WorktreeObservation[];
  projectsScanned: number;
}> {
  const provider = input.providers.worktree;
  const capabilities = provider.capabilities();
  const worktrees: WorktreeObservation[] = [];
  let projectsScanned = 0;

  input.providerHealth[provider.id] = await readProviderHealth({
    providerId: provider.id,
    providerType: "worktree",
    capabilities,
    clock: input.read.clock,
    timeoutMs: input.read.timeoutMs,
    retries: input.read.retries,
    health: () => provider.health(),
    errors: input.errors,
  });

  for (const project of input.projects) {
    const result = await runProviderReadBoundary(
      {
        operation: `provider.${provider.id}.listWorktrees`,
        clock: input.read.clock,
        timeoutMs: input.read.timeoutMs,
        retries: input.read.retries,
        error: {
          tag: "WorktreeProviderError",
          code: "WORKTREE_LIST_FAILED",
          message: "The worktree provider failed to list worktrees.",
          provider: provider.id,
        },
      },
      () => provider.listWorktrees(project),
    );
    if (!result.ok) {
      input.errors.push(result.error);
      await input.read.logger?.error("Worktree provider list failed.", {
        provider: provider.id,
        error: result.error,
        durationMs: result.timing.durationMs,
      });
      input.providerHealth[provider.id] = failedProviderHealth({
        providerId: provider.id,
        providerType: "worktree",
        lastCheckedAt: result.timing.finishedAt,
        lastError: result.error,
        latencyMs: result.timing.durationMs,
        capabilities,
      });
      break;
    }

    projectsScanned += 1;
    worktrees.push(...result.value);
  }

  return { worktrees, projectsScanned };
}

async function readTerminalTargetObservations(input: {
  providers: ProviderRegistry;
  read: ProviderReadOptions;
  providerHealth: Record<string, ProviderHealth>;
  errors: SafeError[];
}): Promise<{
  terminalTargets: TerminalTargetObservation[];
}> {
  const provider = input.providers.terminal;
  const capabilities = provider.capabilities();
  let terminalTargets: TerminalTargetObservation[] = [];

  input.providerHealth[provider.id] = await readProviderHealth({
    providerId: provider.id,
    providerType: "terminal",
    capabilities,
    clock: input.read.clock,
    timeoutMs: input.read.timeoutMs,
    retries: input.read.retries,
    health: () => provider.health(),
    errors: input.errors,
  });

  const result = await runProviderReadBoundary(
    {
      operation: `provider.${provider.id}.listTargets`,
      clock: input.read.clock,
      timeoutMs: input.read.timeoutMs,
      retries: input.read.retries,
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_LIST_FAILED",
        message: "The terminal provider failed to list targets.",
        provider: provider.id,
      },
    },
    () => provider.listTargets(),
  );
  if (result.ok) {
    terminalTargets = result.value;
  } else {
    input.errors.push(result.error);
    await input.read.logger?.error("Terminal provider list failed.", {
      provider: provider.id,
      error: result.error,
      durationMs: result.timing.durationMs,
    });
    input.providerHealth[provider.id] = failedProviderHealth({
      providerId: provider.id,
      providerType: "terminal",
      lastCheckedAt: result.timing.finishedAt,
      lastError: result.error,
      latencyMs: result.timing.durationMs,
      capabilities,
    });
  }

  return { terminalTargets };
}

async function readHarnessObservations(input: {
  providers: ProviderRegistry;
  projects: ProviderProjectConfig[];
  worktrees: WorktreeObservation[];
  terminalTargets: TerminalTargetObservation[];
  read: ProviderReadOptions;
  providerHealth: Record<string, ProviderHealth>;
  errors: SafeError[];
  persistence?: ObserverPersistence;
}): Promise<{
  harnessRuns: HarnessRunObservation[];
  harnessCapabilities: Record<string, HarnessCapabilities>;
}> {
  const harnessRuns: HarnessRunObservation[] = [];
  const harnessCapabilities: Record<string, HarnessCapabilities> = {};
  const hookEvents =
    input.persistence === undefined ? [] : await latestHarnessEventObservations(input.persistence);

  for (const provider of input.providers.harnesses.values()) {
    const capabilities = provider.capabilities();
    harnessCapabilities[provider.id] = capabilities;
    input.providerHealth[provider.id] = await readProviderHealth({
      providerId: provider.id,
      providerType: "harness",
      capabilities,
      clock: input.read.clock,
      timeoutMs: input.read.timeoutMs,
      retries: input.read.retries,
      health: () => provider.health(),
      errors: input.errors,
    });

    const result = await runProviderReadBoundary(
      {
        operation: `provider.${provider.id}.discoverRuns`,
        clock: input.read.clock,
        timeoutMs: input.read.timeoutMs,
        retries: input.read.retries,
        error: {
          tag: "HarnessProviderError",
          code: "HARNESS_DISCOVER_FAILED",
          message: "The harness provider failed to discover runs.",
          provider: provider.id,
        },
      },
      () =>
        provider.discoverRuns({
          projects: input.projects,
          worktrees: input.worktrees,
          terminalTargets: input.terminalTargets,
        }),
    );

    if (result.ok) {
      const classifiedRuns = await classifyHarnessRuns({
        provider,
        capabilities,
        runs: result.value,
        projects: input.projects,
        worktrees: input.worktrees,
        terminalTargets: input.terminalTargets,
        read: input.read,
        providerHealth: input.providerHealth,
        errors: input.errors,
      });
      harnessRuns.push(...runsWithLatestHarnessEvents(classifiedRuns, hookEvents));
      continue;
    }

    input.errors.push(result.error);
    await input.read.logger?.error("Harness provider discovery failed.", {
      provider: provider.id,
      error: result.error,
      durationMs: result.timing.durationMs,
    });
    input.providerHealth[provider.id] = failedProviderHealth({
      providerId: provider.id,
      providerType: "harness",
      lastCheckedAt: result.timing.finishedAt,
      lastError: result.error,
      latencyMs: result.timing.durationMs,
      capabilities,
    });
  }

  return { harnessRuns, harnessCapabilities };
}

async function latestHarnessEventObservations(
  persistence: ObserverPersistence,
): Promise<HarnessEventObservation[]> {
  const observations = await persistence.listProviderObservations();
  const events: HarnessEventObservation[] = [];
  for (const observation of observations) {
    if (observation.entityKind !== "harness_event") {
      continue;
    }
    const result = HarnessEventObservationSchema.safeParse(observation.payload);
    if (!result.success || result.data.status === undefined) {
      continue;
    }
    events.push(result.data);
  }
  return events;
}

function runsWithLatestHarnessEvents(
  runs: HarnessRunObservation[],
  events: HarnessEventObservation[],
): HarnessRunObservation[] {
  return runs.map((run) => {
    const event = latestEventForRun(run, events);
    return event === undefined ? run : runWithHarnessEvent(run, event);
  });
}

function latestEventForRun(
  run: HarnessRunObservation,
  events: HarnessEventObservation[],
): HarnessEventObservation | undefined {
  let latest: HarnessEventObservation | undefined;
  for (const event of events) {
    if (!eventMatchesRun(event, run)) {
      continue;
    }
    if (latest === undefined || Date.parse(event.observedAt) >= Date.parse(latest.observedAt)) {
      latest = event;
    }
  }
  return latest;
}

function eventMatchesRun(event: HarnessEventObservation, run: HarnessRunObservation): boolean {
  if (event.provider !== run.provider) {
    return false;
  }
  if (event.harnessRunId !== undefined && event.harnessRunId === run.id) {
    return true;
  }
  if (
    event.sessionId !== undefined &&
    run.sessionId !== undefined &&
    event.sessionId === run.sessionId
  ) {
    return true;
  }
  if (
    event.worktreeId !== undefined &&
    run.worktreeId !== undefined &&
    event.worktreeId === run.worktreeId
  ) {
    return true;
  }
  return false;
}

function runWithHarnessEvent(
  run: HarnessRunObservation,
  event: HarnessEventObservation,
): HarnessRunObservation {
  const status = event.status;
  if (status === undefined) {
    return run;
  }

  const updated: HarnessRunObservation = {
    ...run,
    state: status.value,
    confidence: status.confidence,
    reason: status.reason,
    observedAt: status.updatedAt,
    providerData: providerDataWithLatestEvent(run.providerData, event),
  };
  if (event.worktreeId !== undefined) {
    updated.worktreeId = event.worktreeId;
  }
  if (event.sessionId !== undefined) {
    updated.sessionId = event.sessionId;
  }
  return updated;
}

function providerDataWithLatestEvent(
  existing: unknown,
  event: HarnessEventObservation,
): Record<string, unknown> {
  const providerData: Record<string, unknown> =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const latestEvent: Record<string, unknown> = {
    observedAt: event.observedAt,
  };
  if (event.rawEventType !== undefined) {
    latestEvent.rawEventType = event.rawEventType;
  }
  if (event.status !== undefined) {
    latestEvent.status = event.status;
  }
  if (event.providerData !== undefined) {
    latestEvent.providerData = event.providerData;
  }
  providerData.latestEvent = latestEvent;
  return providerData;
}

async function classifyHarnessRuns(input: {
  provider: HarnessProvider;
  capabilities: HarnessCapabilities;
  runs: HarnessRunObservation[];
  projects: ProviderProjectConfig[];
  worktrees: WorktreeObservation[];
  terminalTargets: TerminalTargetObservation[];
  read: ProviderReadOptions;
  providerHealth: Record<string, ProviderHealth>;
  errors: SafeError[];
}): Promise<HarnessRunObservation[]> {
  const classifiedRuns: HarnessRunObservation[] = [];
  for (const run of input.runs) {
    const classification = await runProviderReadBoundary(
      {
        operation: `provider.${input.provider.id}.classifyRun`,
        clock: input.read.clock,
        timeoutMs: input.read.timeoutMs,
        retries: input.read.retries,
        error: {
          tag: "HarnessProviderError",
          code: "HARNESS_CLASSIFY_FAILED",
          message: "The harness provider failed to classify a run.",
          provider: input.provider.id,
        },
      },
      () =>
        input.provider.classifyRun(run, {
          projects: input.projects,
          worktrees: input.worktrees,
          terminalTargets: input.terminalTargets,
        }),
    );

    if (classification.ok) {
      classifiedRuns.push(runWithStatus(run, classification.value));
      continue;
    }

    input.errors.push(classification.error);
    await input.read.logger?.error("Harness provider classification failed.", {
      provider: input.provider.id,
      error: classification.error,
      durationMs: classification.timing.durationMs,
    });
    input.providerHealth[input.provider.id] = failedProviderHealth({
      providerId: input.provider.id,
      providerType: "harness",
      lastCheckedAt: classification.timing.finishedAt,
      lastError: classification.error,
      latencyMs: classification.timing.durationMs,
      capabilities: input.capabilities,
    });
  }

  return classifiedRuns;
}

async function persistReconcileResult(input: {
  persistence?: ObserverPersistence;
  projects: ProviderProjectConfig[];
  worktrees: WorktreeObservation[];
  terminalTargets: TerminalTargetObservation[];
  harnessRuns: HarnessRunObservation[];
  providerHealth: Record<string, ProviderHealth>;
  observedAt: string;
}): Promise<number> {
  if (input.persistence === undefined) {
    return 0;
  }

  await input.persistence.persistReconcileResult({
    projects: input.projects,
    worktrees: input.worktrees,
    terminalTargets: input.terminalTargets,
    harnessRuns: input.harnessRuns,
    providerHealth: input.providerHealth,
    observedAt: input.observedAt,
  });
  await input.persistence.recordEvent(
    {
      type: "observer.reconciled",
      at: input.observedAt,
      changed: 0,
    },
    { createdAt: input.observedAt },
  );

  return 1;
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

function runWithStatus(
  run: HarnessRunObservation,
  classification: HarnessStatusObservation,
): HarnessRunObservation {
  return {
    ...run,
    ...(classification.projectId === undefined ? {} : { projectId: classification.projectId }),
    ...(classification.worktreeId === undefined ? {} : { worktreeId: classification.worktreeId }),
    ...(classification.sessionId === undefined ? {} : { sessionId: classification.sessionId }),
    state: classification.status.value,
    confidence: classification.status.confidence,
    reason: classification.status.reason,
    observedAt: classification.status.updatedAt,
    ...(classification.providerData === undefined
      ? {}
      : { providerData: classification.providerData }),
  };
}
