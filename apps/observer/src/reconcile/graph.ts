import type {
  AgentState,
  HarnessCapabilities,
  HarnessRunObservation,
  OrphanedRuntimeState,
  ProviderHealth,
  ProviderId,
  ProviderProjectConfig,
  SafeError,
  SessionView,
  TerminalTargetObservation,
  WorktreeObservation,
  WorktreeRow,
  WosmAlert,
  WosmSnapshot,
} from "@wosm/contracts";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";

export type ObserverGraphProject = ProviderProjectConfig;

export type ObserverGraphInput = {
  generatedAt: string;
  observer: {
    pid: number;
    startedAt: string;
    version: string;
    healthy?: boolean;
  };
  projects: ObserverGraphProject[];
  worktreeProviderId: ProviderId;
  providerHealth: Record<string, ProviderHealth>;
  harnessCapabilities?: Record<string, HarnessCapabilities>;
  worktrees: WorktreeObservation[];
  terminalTargets: TerminalTargetObservation[];
  harnessRuns: HarnessRunObservation[];
  alerts?: WosmAlert[];
};

const emptyHarnessCapabilities: HarnessCapabilities = {
  canLaunch: false,
  canDiscoverRuns: false,
  canEmitEvents: false,
  canClassifyStatus: false,
  canReceivePrompt: false,
  canResume: false,
  canStop: false,
  canRunNonInteractive: false,
  canExposeApprovalState: false,
};

const confidenceRank = {
  high: 3,
  medium: 2,
  low: 1,
};

const statusPolicy: Record<
  AgentState | "no_agent",
  {
    label: WorktreeRow["display"]["statusLabel"];
    priority: number;
    alert: boolean;
    warning: boolean;
  }
> = {
  needs_attention: {
    label: "needs attention",
    priority: 10,
    alert: true,
    warning: false,
  },
  stuck: {
    label: "stuck",
    priority: 20,
    alert: true,
    warning: true,
  },
  working: {
    label: "working",
    priority: 30,
    alert: false,
    warning: false,
  },
  starting: {
    label: "starting",
    priority: 35,
    alert: false,
    warning: false,
  },
  idle: {
    label: "idle",
    priority: 40,
    alert: false,
    warning: false,
  },
  unknown: {
    label: "unknown",
    priority: 50,
    alert: false,
    warning: false,
  },
  exited: {
    label: "exited",
    priority: 60,
    alert: false,
    warning: false,
  },
  none: {
    label: "no agent",
    priority: 70,
    alert: false,
    warning: false,
  },
  no_agent: {
    label: "no agent",
    priority: 70,
    alert: false,
    warning: false,
  },
};

export function buildWosmSnapshot(input: ObserverGraphInput): WosmSnapshot {
  const projectsById = new Map(input.projects.map((project) => [project.id, project]));
  const configuredWorktrees = input.worktrees.filter((worktree) =>
    projectsById.has(worktree.projectId),
  );
  const worktreesById = new Map(configuredWorktrees.map((worktree) => [worktree.id, worktree]));
  const harnessRunsById = new Map(input.harnessRuns.map((run) => [run.id, run]));
  const providerAlerts = alertsFromProviderHealth(input.providerHealth, input.generatedAt);
  const alerts = [...providerAlerts, ...(input.alerts ?? [])];
  const allRows: WorktreeRow[] = [];
  const sessions: SessionView[] = [];

  for (const project of input.projects) {
    const rowsForProject = configuredWorktrees
      .filter((worktree) => worktree.projectId === project.id)
      .map((worktree) => {
        const terminal = chooseTerminal(worktree, input.terminalTargets);
        const harnessRun = chooseHarnessRun(worktree, terminal, input.harnessRuns);
        const row = buildWorktreeRow({
          project,
          worktree,
          ...(terminal === undefined ? {} : { terminal }),
          ...(harnessRun === undefined ? {} : { harnessRun }),
        });

        const session = buildSession({
          project,
          worktree,
          harnessCapabilities: input.harnessCapabilities ?? {},
          ...(terminal === undefined ? {} : { terminal }),
          ...(harnessRun === undefined ? {} : { harnessRun }),
        });
        if (session !== undefined) {
          sessions.push(session);
        }

        return row;
      })
      .sort(compareRows);

    allRows.push(...rowsForProject);
  }

  const projects = input.projects.map((project) => {
    const rows = allRows.filter((row) => row.projectId === project.id);
    return {
      id: project.id,
      label: project.label,
      root: project.root,
      defaults: project.defaults,
      health: input.providerHealth[input.worktreeProviderId] ?? unknownProviderHealth(input),
      counts: countRows(rows),
    };
  });

  const counts = {
    projects: input.projects.length,
    ...countRows(allRows),
  };

  const observerHealthy =
    input.observer.healthy ??
    (!alerts.some((alert) => alert.severity === "error") &&
      Object.values(input.providerHealth).every((health) => health.status !== "unavailable"));

  return {
    schemaVersion: WOSM_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    observer: {
      pid: input.observer.pid,
      startedAt: input.observer.startedAt,
      version: input.observer.version,
      healthy: observerHealthy,
    },
    providerHealth: input.providerHealth,
    projects,
    rows: allRows,
    sessions,
    counts,
    alerts,
    ...orphans(input, worktreesById, projectsById, harnessRunsById),
  };
}

function buildWorktreeRow(input: {
  project: ObserverGraphProject;
  worktree: WorktreeObservation;
  terminal?: TerminalTargetObservation;
  harnessRun?: HarnessRunObservation;
}): WorktreeRow {
  const state = input.harnessRun?.state ?? "no_agent";
  const policy = statusPolicy[state];
  const warning = warningFor(input.harnessRun, input.terminal, policy.warning);
  const reason = displayReason(input.harnessRun, warning);

  return {
    id: input.worktree.id,
    projectId: input.project.id,
    projectLabel: input.project.label,
    branch: input.worktree.branch,
    path: input.worktree.path,
    worktree: {
      state: input.worktree.state,
      source: input.worktree.source,
      ...(input.worktree.dirty === undefined ? {} : { dirty: input.worktree.dirty }),
      ...(input.worktree.ahead === undefined ? {} : { ahead: input.worktree.ahead }),
      ...(input.worktree.behind === undefined ? {} : { behind: input.worktree.behind }),
      ...(input.worktree.pr === undefined ? {} : { pr: input.worktree.pr }),
    },
    ...(input.terminal === undefined ? {} : { terminal: rowTerminal(input.terminal) }),
    ...(input.harnessRun === undefined ? {} : { agent: rowAgent(input.harnessRun) }),
    display: {
      statusLabel: policy.label,
      sortPriority: policy.priority,
      alert: policy.alert,
      ...(warning ? { warning: true } : {}),
      ...(reason === undefined ? {} : { reason }),
    },
  };
}

function rowTerminal(terminal: TerminalTargetObservation): WorktreeRow["terminal"] {
  return {
    provider: terminal.provider,
    state: terminal.state,
    workspaceTargetId: terminal.id,
    primaryAgentTargetId: terminal.id,
  };
}

function rowAgent(harnessRun: HarnessRunObservation): WorktreeRow["agent"] {
  return {
    harness: harnessRun.provider,
    state: harnessRun.state,
    ...(harnessRun.pid === undefined ? {} : { pid: harnessRun.pid }),
    runId: harnessRun.id,
    ...(harnessRun.sessionId === undefined ? {} : { sessionId: harnessRun.sessionId }),
    confidence: harnessRun.confidence,
    reason: harnessRun.reason,
    updatedAt: harnessRun.observedAt,
  };
}

function buildSession(input: {
  project: ObserverGraphProject;
  worktree: WorktreeObservation;
  terminal?: TerminalTargetObservation;
  harnessRun?: HarnessRunObservation;
  harnessCapabilities: Record<string, HarnessCapabilities>;
}): SessionView | undefined {
  if (input.terminal === undefined || input.harnessRun === undefined) {
    return undefined;
  }

  const sessionId = input.harnessRun.sessionId ?? input.terminal.sessionId;
  if (sessionId === undefined) {
    return undefined;
  }

  return {
    id: sessionId,
    projectId: input.project.id,
    worktreeId: input.worktree.id,
    createdAt: input.harnessRun.observedAt,
    updatedAt: input.harnessRun.observedAt,
    harness: {
      provider: input.harnessRun.provider,
      mode: "unknown",
      ...(input.harnessRun.pid === undefined ? {} : { pid: input.harnessRun.pid }),
      runId: input.harnessRun.id,
      capabilities:
        input.harnessCapabilities[input.harnessRun.provider] ?? emptyHarnessCapabilities,
    },
    terminal: {
      provider: input.terminal.provider,
      exists: input.terminal.state !== "stale",
      workspaceTargetId: input.terminal.id,
      primaryAgentTargetId: input.terminal.id,
      ...(input.terminal.sessionId === undefined ? {} : { sessionId: input.terminal.sessionId }),
    },
    status: {
      value: input.harnessRun.state,
      confidence: input.harnessRun.confidence,
      reason: input.harnessRun.reason,
      source: "harness_process",
      updatedAt: input.harnessRun.observedAt,
    },
    title: `${input.project.label} ${input.worktree.branch}`,
    tags: [],
  };
}

function chooseTerminal(
  worktree: WorktreeObservation,
  terminals: TerminalTargetObservation[],
): TerminalTargetObservation | undefined {
  return terminals
    .filter((terminal) => terminal.worktreeId === worktree.id)
    .sort(compareObservations)[0];
}

function chooseHarnessRun(
  worktree: WorktreeObservation,
  terminal: TerminalTargetObservation | undefined,
  runs: HarnessRunObservation[],
): HarnessRunObservation | undefined {
  if (terminal?.harnessRunId !== undefined) {
    const boundRun = runs.find((run) => run.id === terminal.harnessRunId);
    if (boundRun !== undefined) {
      return boundRun;
    }
  }

  return runs.filter((run) => run.worktreeId === worktree.id).sort(compareHarnessRuns)[0];
}

function compareRows(left: WorktreeRow, right: WorktreeRow): number {
  return (
    left.display.sortPriority - right.display.sortPriority ||
    left.branch.localeCompare(right.branch) ||
    left.id.localeCompare(right.id)
  );
}

function compareObservations(
  left: TerminalTargetObservation,
  right: TerminalTargetObservation,
): number {
  return (
    confidenceRank[right.confidence] - confidenceRank[left.confidence] ||
    Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareHarnessRuns(left: HarnessRunObservation, right: HarnessRunObservation): number {
  return (
    statusPolicy[left.state].priority - statusPolicy[right.state].priority ||
    confidenceRank[right.confidence] - confidenceRank[left.confidence] ||
    Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
    left.id.localeCompare(right.id)
  );
}

function countRows(rows: WorktreeRow[]) {
  return rows.reduce(
    (counts, row) => {
      counts.worktrees += 1;
      if (row.agent !== undefined) {
        counts.agents += 1;
        if (row.agent.state === "working") {
          counts.working += 1;
        }
        if (row.agent.state === "idle") {
          counts.idle += 1;
        }
        if (row.agent.state === "needs_attention") {
          counts.attention += 1;
        }
        if (row.agent.state === "unknown") {
          counts.unknown += 1;
        }
      }
      return counts;
    },
    {
      worktrees: 0,
      agents: 0,
      working: 0,
      idle: 0,
      attention: 0,
      unknown: 0,
    },
  );
}

function displayReason(
  harnessRun: HarnessRunObservation | undefined,
  warning: boolean,
): string | undefined {
  if (harnessRun === undefined) {
    return "No harness run is associated with this worktree.";
  }
  if (harnessRun.state === "needs_attention" || harnessRun.state === "stuck" || warning) {
    return harnessRun.reason;
  }
  return undefined;
}

function warningFor(
  harnessRun: HarnessRunObservation | undefined,
  terminal: TerminalTargetObservation | undefined,
  defaultWarning: boolean,
): boolean {
  if (defaultWarning) {
    return true;
  }
  if (harnessRun?.state !== "unknown") {
    return false;
  }

  const reason = `${harnessRun.reason} ${terminal?.reason ?? ""}`.toLowerCase();
  return (
    reason.includes("conflict") ||
    reason.includes("stale") ||
    reason.includes("failed") ||
    reason.includes("invalid")
  );
}

function unknownProviderHealth(input: ObserverGraphInput): ProviderHealth {
  return {
    providerId: input.worktreeProviderId,
    providerType: "worktree",
    status: "unknown",
    lastCheckedAt: input.generatedAt,
  };
}

function alertsFromProviderHealth(
  providerHealth: Record<string, ProviderHealth>,
  generatedAt: string,
): WosmAlert[] {
  return Object.values(providerHealth)
    .filter((health) => health.status === "unavailable" || health.status === "degraded")
    .map((health) => {
      const alert: WosmAlert = {
        id: `alert_${health.providerId}_${health.status}`,
        severity: health.status === "unavailable" ? "error" : "warn",
        message:
          health.lastError?.message ??
          `The ${health.providerType} provider ${health.providerId} is ${health.status}.`,
        provider: health.providerId,
        createdAt: generatedAt,
      };
      if (health.lastError?.code !== undefined) {
        alert.code = health.lastError.code;
      }
      return alert;
    });
}

function orphans(
  input: ObserverGraphInput,
  worktreesById: Map<string, WorktreeObservation>,
  projectsById: Map<string, ObserverGraphProject>,
  harnessRunsById: Map<string, HarnessRunObservation>,
): { orphans?: OrphanedRuntimeState[] } {
  const orphans: OrphanedRuntimeState[] = [];

  for (const terminal of input.terminalTargets) {
    const hasProject = terminal.projectId === undefined || projectsById.has(terminal.projectId);
    const hasWorktree = terminal.worktreeId !== undefined && worktreesById.has(terminal.worktreeId);
    const hasHarness =
      terminal.harnessRunId === undefined || harnessRunsById.has(terminal.harnessRunId);

    if (!hasProject || !hasWorktree || !hasHarness) {
      orphans.push({
        id: `orphan_${terminal.id}`,
        kind: "terminal_target",
        provider: terminal.provider,
        ...(terminal.projectId === undefined ? {} : { projectId: terminal.projectId }),
        ...(terminal.worktreeId === undefined ? {} : { worktreeId: terminal.worktreeId }),
        ...(terminal.sessionId === undefined ? {} : { sessionId: terminal.sessionId }),
        terminalTargetId: terminal.id,
        reason: "Terminal target has no matching configured project or worktree.",
        observedAt: terminal.observedAt,
        ...(terminal.providerData === undefined ? {} : { providerData: terminal.providerData }),
      });
    }
  }

  for (const run of input.harnessRuns) {
    const hasProject = run.projectId === undefined || projectsById.has(run.projectId);
    const hasWorktree = run.worktreeId !== undefined && worktreesById.has(run.worktreeId);

    if (!hasProject || !hasWorktree) {
      orphans.push({
        id: `orphan_${run.id}`,
        kind: "harness_run",
        provider: run.provider,
        ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
        ...(run.worktreeId === undefined ? {} : { worktreeId: run.worktreeId }),
        ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
        harnessRunId: run.id,
        reason: "Harness run has no matching configured project or worktree.",
        observedAt: run.observedAt,
        ...(run.providerData === undefined ? {} : { providerData: run.providerData }),
      });
    }
  }

  return orphans.length === 0 ? {} : { orphans };
}

export function safeErrorToProviderHealth(input: {
  providerId: ProviderId;
  providerType: ProviderHealth["providerType"];
  lastCheckedAt: string;
  lastError: SafeError;
  capabilities?: Record<string, boolean>;
  latencyMs?: number;
}): ProviderHealth {
  return {
    providerId: input.providerId,
    providerType: input.providerType,
    status: "unavailable",
    lastCheckedAt: input.lastCheckedAt,
    lastError: input.lastError,
    ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
    ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
  };
}
