import type {
  HarnessCapabilities,
  ProjectView,
  ProviderHealth,
  SessionView,
  WorktreeChecksSummary,
  WorktreeRow,
  WosmSnapshot,
} from "@wosm/contracts";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";

export type FakeDashboardOptions = {
  generatedAt?: string;
  projectCount?: number;
  worktreesPerProject?: number;
};

const defaultGeneratedAt = "2026-05-20T12:00:00.000Z";
const harnesses = ["codex", "opencode", "scripted", "pi"] as const;
const stateCycle = [
  "working",
  "idle",
  "needs_attention",
  "stuck",
  "unknown",
  "exited",
  "starting",
  "none",
] as const;
const topicCycle = [
  "checkout-copy",
  "cache-refactor",
  "nav-polish",
  "queue-worker",
  "snapshot-diff",
  "terminal-focus",
  "protocol-wait",
  "doctor-cleanup",
] as const;
const checksStateCycle = ["pass", "fail", "running", "cancelled", "none"] as const;

const defaultCapabilities: HarnessCapabilities = {
  canLaunch: true,
  canDiscoverRuns: true,
  canEmitEvents: true,
  canClassifyStatus: true,
  canReceivePrompt: true,
  canResume: true,
  canStop: true,
  canRunNonInteractive: true,
  canExposeApprovalState: true,
};

type FakeAgentState = NonNullable<WorktreeRow["agent"]>["state"] | "none";

export function createFakeDashboardSnapshot(options: FakeDashboardOptions = {}): WosmSnapshot {
  const projectCount = options.projectCount ?? 4;
  const worktreesPerProject = options.worktreesPerProject ?? 24;
  const generatedAt = options.generatedAt ?? defaultGeneratedAt;
  const rows = Array.from({ length: projectCount }).flatMap((_, projectIndex) =>
    Array.from({ length: worktreesPerProject }, (_unused, worktreeIndex) =>
      fakeWorktreeRow(projectIndex, worktreeIndex, generatedAt),
    ),
  );
  const projects = Array.from({ length: projectCount }).map((_, index) =>
    fakeProject(index, rows, generatedAt),
  );
  const sessions = rows.flatMap((row) => (row.agent === undefined ? [] : [fakeSession(row)]));
  return {
    schemaVersion: WOSM_SCHEMA_VERSION,
    generatedAt,
    observer: {
      pid: 4242,
      startedAt: "2026-05-20T11:55:00.000Z",
      version: "0.0.0-dev",
      healthy: true,
    },
    providerHealth: providerHealth(generatedAt),
    harnesses: harnesses.map((id) => ({ id, label: id })),
    projects,
    rows,
    sessions,
    counts: {
      projects: projects.length,
      ...countsForRows(rows),
    },
    alerts: [],
  };
}

function fakeProject(
  index: number,
  rows: readonly WorktreeRow[],
  generatedAt: string,
): ProjectView {
  const id = projectId(index);
  const defaultHarness = harnessForProject(index);
  const projectRows = rows.filter((row) => row.projectId === id);
  return {
    id,
    label: `project-${index + 1}`,
    root: `/tmp/wosm/fake/project-${index + 1}`,
    defaults: {
      harness: defaultHarness,
      terminal: "tmux",
      layout: "agent-build-shell",
    },
    health: healthyProvider(defaultHarness, "harness", generatedAt),
    counts: countsForProject(projectRows),
  };
}

function fakeWorktreeRow(
  projectIndex: number,
  worktreeIndex: number,
  generatedAt: string,
): WorktreeRow {
  const project = projectId(projectIndex);
  const branch = fakeBranch(projectIndex, worktreeIndex);
  const state = stateCycle[(projectIndex + worktreeIndex) % stateCycle.length];
  if (state === undefined) {
    throw new Error("Fake dashboard state cycle is empty.");
  }
  const id = `wt_fake_${projectIndex + 1}_${worktreeIndex + 1}`;
  const row: WorktreeRow = {
    id,
    projectId: project,
    projectLabel: `project-${projectIndex + 1}`,
    branch,
    path: `/tmp/wosm/fake/project-${projectIndex + 1}/worktrees/${branch}`,
    worktree: fakeWorktreeRuntime(projectIndex, worktreeIndex, generatedAt),
    display: displayForState(state),
  };
  if (state !== "none") {
    row.terminal = {
      provider: "tmux",
      state: worktreeIndex % 11 === 0 ? "detached" : "open",
      workspaceTargetId: `term_${id}_workspace`,
      primaryAgentTargetId: `term_${id}_agent`,
      attached: worktreeIndex % 11 !== 0,
      lastOutputAt: generatedAt,
    };
    row.agent = {
      harness: harnessForWorktree(projectIndex, worktreeIndex),
      state,
      runId: `run_${id}`,
      sessionId: `ses_${id}`,
      confidence: state === "unknown" ? "low" : "high",
      reason: reasonForState(state),
      updatedAt: generatedAt,
    };
  }
  return row;
}

function fakeWorktreeRuntime(
  projectIndex: number,
  worktreeIndex: number,
  generatedAt: string,
): WorktreeRow["worktree"] {
  const runtime: WorktreeRow["worktree"] = {
    state: "exists",
    source: "worktrunk",
    dirty: worktreeIndex % 5 === 0,
    ahead: worktreeIndex % 4,
    behind: worktreeIndex % 3,
  };
  if (worktreeIndex % 2 === 0) {
    runtime.changeSummary = {
      kind: "branch_diff",
      additions: (worktreeIndex + 1) * 3,
      deletions: worktreeIndex + projectIndex,
      filesChanged: (worktreeIndex % 7) + 1,
      baseRef: "main",
      baseSha: "a".repeat(40),
      headRef: fakeBranch(projectIndex, worktreeIndex),
      headSha: "b".repeat(40),
      source: "fake-dashboard",
      checkedAt: generatedAt,
      stale: worktreeIndex % 10 === 0,
    };
  }
  if (worktreeIndex % 3 === 0) {
    runtime.pr = {
      number: 1000 + projectIndex * 100 + worktreeIndex,
      url: `https://example.com/wosm/fake/pull/${1000 + projectIndex * 100 + worktreeIndex}`,
      host: "github",
      state: worktreeIndex % 9 === 0 ? "draft" : "open",
      baseRef: "main",
      headRef: fakeBranch(projectIndex, worktreeIndex),
      updatedAt: generatedAt,
      checkedAt: generatedAt,
      stale: worktreeIndex % 12 === 0,
    };
  }
  const checks = checksForWorktree(worktreeIndex, generatedAt);
  if (checks !== undefined) {
    runtime.checks = checks;
  }
  return runtime;
}

function checksForWorktree(
  worktreeIndex: number,
  generatedAt: string,
): WorktreeChecksSummary | undefined {
  const state = checksStateCycle[worktreeIndex % checksStateCycle.length];
  if (state === undefined || state === "none") {
    return undefined;
  }
  const checks: WorktreeChecksSummary = {
    state,
    source: "fake-dashboard",
    checkedAt: generatedAt,
    total: 6,
  };
  if (state === "pass") {
    checks.passed = 6;
  }
  if (state === "fail") {
    checks.passed = 4;
    checks.failed = 2;
  }
  if (state === "running") {
    checks.passed = 3;
    checks.pending = 3;
  }
  if (state === "cancelled") {
    checks.cancelled = 1;
    checks.reason = "fake cancellation";
  }
  return checks;
}

function fakeSession(row: WorktreeRow): SessionView {
  if (row.agent === undefined || row.terminal === undefined) {
    throw new Error("Cannot create a fake session without agent and terminal state.");
  }
  const session: SessionView = {
    id: row.agent.sessionId ?? `ses_${row.id}`,
    projectId: row.projectId,
    worktreeId: row.id,
    createdAt: "2026-05-20T11:59:00.000Z",
    updatedAt: row.agent.updatedAt,
    harness: {
      provider: row.agent.harness,
      mode: "interactive",
      capabilities: defaultCapabilities,
    },
    terminal: {
      provider: row.terminal.provider,
      exists: row.terminal.state === "open" || row.terminal.state === "detached",
    },
    status: {
      value: row.agent.state,
      confidence: row.agent.confidence,
      reason: row.agent.reason,
      source: "harness_event",
      updatedAt: row.agent.updatedAt,
    },
    title: row.branch,
    tags: [row.agent.harness, row.terminal.provider],
  };
  if (row.agent.runId !== undefined) {
    session.harness.runId = row.agent.runId;
  }
  if (row.terminal.workspaceTargetId !== undefined) {
    session.terminal.workspaceTargetId = row.terminal.workspaceTargetId;
  }
  if (row.terminal.primaryAgentTargetId !== undefined) {
    session.terminal.primaryAgentTargetId = row.terminal.primaryAgentTargetId;
  }
  if (row.terminal.attached !== undefined) {
    session.terminal.attached = row.terminal.attached;
  }
  if (row.terminal.lastOutputAt !== undefined) {
    session.terminal.lastOutputAt = row.terminal.lastOutputAt;
  }
  return session;
}

function displayForState(state: FakeAgentState): WorktreeRow["display"] {
  if (state === "needs_attention") {
    return {
      statusLabel: "needs attention",
      sortPriority: 10,
      alert: true,
      warning: true,
      reason: reasonForState(state),
    };
  }
  if (state === "stuck") {
    return {
      statusLabel: "stuck",
      sortPriority: 20,
      alert: true,
      warning: true,
      reason: reasonForState(state),
    };
  }
  if (state === "working") {
    return {
      statusLabel: "working",
      sortPriority: 30,
      alert: false,
      reason: reasonForState(state),
    };
  }
  if (state === "idle") {
    return { statusLabel: "idle", sortPriority: 40, alert: false, reason: reasonForState(state) };
  }
  if (state === "unknown") {
    return {
      statusLabel: "unknown",
      sortPriority: 50,
      alert: false,
      reason: reasonForState(state),
    };
  }
  if (state === "exited") {
    return { statusLabel: "exited", sortPriority: 60, alert: false, reason: reasonForState(state) };
  }
  if (state === "starting") {
    return {
      statusLabel: "starting",
      sortPriority: 65,
      alert: false,
      reason: reasonForState(state),
    };
  }
  return {
    statusLabel: "no agent",
    sortPriority: 70,
    alert: false,
    reason: "No fake harness run is associated with this worktree.",
  };
}

function reasonForState(state: Exclude<FakeAgentState, "none">): string {
  if (state === "needs_attention") return "Fake approval is waiting.";
  if (state === "stuck") return "Fake run stopped making progress.";
  if (state === "working") return "Fake harness is generating.";
  if (state === "idle") return "Fake turn completed.";
  if (state === "unknown") return "Fake classifier is uncertain.";
  if (state === "exited") return "Fake harness process exited.";
  return "Fake harness run is starting.";
}

function providerHealth(generatedAt: string): Record<string, ProviderHealth> {
  return {
    worktrunk: healthyProvider("worktrunk", "worktree", generatedAt),
    tmux: healthyProvider("tmux", "terminal", generatedAt),
    codex: healthyProvider("codex", "harness", generatedAt),
    opencode: healthyProvider("opencode", "harness", generatedAt),
    scripted: healthyProvider("scripted", "harness", generatedAt),
    pi: healthyProvider("pi", "harness", generatedAt),
    github: healthyProvider("github", "repository", generatedAt),
  };
}

function healthyProvider(
  providerId: string,
  providerType: ProviderHealth["providerType"],
  generatedAt: string,
): ProviderHealth {
  return {
    providerId,
    providerType,
    status: "healthy",
    lastCheckedAt: generatedAt,
  };
}

function countsForRows(rows: readonly WorktreeRow[]) {
  return {
    worktrees: rows.length,
    agents: rows.filter((row) => row.agent !== undefined).length,
    working: rows.filter((row) => row.display.statusLabel === "working").length,
    idle: rows.filter((row) => row.display.statusLabel === "idle").length,
    attention: rows.filter((row) => row.display.statusLabel === "needs attention").length,
    unknown: rows.filter((row) => row.display.statusLabel === "unknown").length,
  };
}

function countsForProject(rows: readonly WorktreeRow[]): ProjectView["counts"] {
  const counts = countsForRows(rows);
  return {
    worktrees: counts.worktrees,
    agents: counts.agents,
    working: counts.working,
    idle: counts.idle,
    attention: counts.attention,
    unknown: counts.unknown,
  };
}

function projectId(index: number): string {
  return `fake-project-${index + 1}`;
}

function harnessForProject(index: number): string {
  return harnesses[index % harnesses.length] ?? "codex";
}

function harnessForWorktree(projectIndex: number, worktreeIndex: number): string {
  return harnesses[(projectIndex + worktreeIndex) % harnesses.length] ?? "codex";
}

function fakeBranch(projectIndex: number, worktreeIndex: number): string {
  const topic = topicCycle[worktreeIndex % topicCycle.length] ?? "branch";
  return `${topic}-${projectIndex + 1}-${String(worktreeIndex + 1).padStart(2, "0")}`;
}
