import type { DatabaseSync } from "node:sqlite";
import type {
  HarnessRunObservation,
  ProviderProjectConfig,
  TerminalTargetObservation,
  WorktreeObservation,
} from "@wosm/contracts";
import {
  HarnessRunObservationSchema,
  TerminalTargetObservationSchema,
  WorktreeObservationSchema,
} from "@wosm/contracts";
import { maxIso, optionalJson } from "./json.js";
import { insertProviderObservation } from "./observations.js";
import {
  harnessRunFromRow,
  projectFromRow,
  type SqliteHarnessRunRow,
  type SqliteProjectRow,
  type SqliteSessionRow,
  type SqliteTerminalTargetRow,
  type SqliteWorktreeRow,
  sessionFromRow,
  terminalTargetFromRow,
  worktreeFromRow,
} from "./rows.js";
import type {
  ObserverIdFactory,
  PersistedHarnessRun,
  PersistedProject,
  PersistedSession,
  PersistedTerminalTarget,
  PersistedWorktree,
  PersistReconcileResultInput,
} from "./types.js";

export function persistReconcileResult(
  database: DatabaseSync,
  input: PersistReconcileResultInput,
  options: { observedAt: string; idFactory: ObserverIdFactory },
): void {
  for (const project of input.projects) {
    upsertProject(database, project, options.observedAt);
  }
  for (const worktree of input.worktrees.map((value) => WorktreeObservationSchema.parse(value))) {
    upsertWorktree(database, worktree);
    insertProviderObservation(database, {
      id: options.idFactory.observationId(),
      provider: worktree.provider,
      providerType: "worktree",
      entityKind: "worktree",
      entityKey: worktree.id,
      payload: worktree,
      observedAt: worktree.observedAt,
      expiresAt: input.expiresAt,
    });
  }
  for (const target of input.terminalTargets.map((value) =>
    TerminalTargetObservationSchema.parse(value),
  )) {
    upsertTerminalTarget(database, target);
    insertProviderObservation(database, {
      id: options.idFactory.observationId(),
      provider: target.provider,
      providerType: "terminal",
      entityKind: "terminal_target",
      entityKey: target.id,
      payload: target,
      observedAt: target.observedAt,
      expiresAt: input.expiresAt,
    });
  }
  for (const run of input.harnessRuns.map((value) => HarnessRunObservationSchema.parse(value))) {
    upsertHarnessRun(database, run);
    insertProviderObservation(database, {
      id: options.idFactory.observationId(),
      provider: run.provider,
      providerType: "harness",
      entityKind: "harness_run",
      entityKey: run.id,
      payload: run,
      observedAt: run.observedAt,
      expiresAt: input.expiresAt,
    });
  }
  if (input.providerHealth !== undefined) {
    for (const health of Object.values(input.providerHealth)) {
      insertProviderObservation(database, {
        id: options.idFactory.observationId(),
        provider: health.providerId,
        providerType: "observer",
        entityKind: "provider_health",
        entityKey: health.providerId,
        payload: health,
        observedAt: health.lastCheckedAt,
        expiresAt: input.expiresAt,
      });
    }
  }
  upsertSessions(database, input.terminalTargets, input.harnessRuns);
}

export function listProjects(database: DatabaseSync): PersistedProject[] {
  return (database.prepare("SELECT * FROM projects ORDER BY id").all() as SqliteProjectRow[]).map(
    projectFromRow,
  );
}

export function listWorktrees(database: DatabaseSync): PersistedWorktree[] {
  return (database.prepare("SELECT * FROM worktrees ORDER BY id").all() as SqliteWorktreeRow[]).map(
    worktreeFromRow,
  );
}

export function listTerminalTargets(database: DatabaseSync): PersistedTerminalTarget[] {
  return (
    database
      .prepare("SELECT * FROM terminal_targets ORDER BY id")
      .all() as SqliteTerminalTargetRow[]
  ).map(terminalTargetFromRow);
}

export function listHarnessRuns(database: DatabaseSync): PersistedHarnessRun[] {
  return (
    database.prepare("SELECT * FROM harness_runs ORDER BY id").all() as SqliteHarnessRunRow[]
  ).map(harnessRunFromRow);
}

export function listSessions(database: DatabaseSync): PersistedSession[] {
  return (database.prepare("SELECT * FROM sessions ORDER BY id").all() as SqliteSessionRow[]).map(
    sessionFromRow,
  );
}

function upsertProject(
  database: DatabaseSync,
  project: ProviderProjectConfig | PersistedProject,
  lastSeenAt: string,
): void {
  database
    .prepare(
      `
        INSERT INTO projects (id, label, root, repo, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          root = excluded.root,
          repo = excluded.repo,
          last_seen_at = excluded.last_seen_at
      `,
    )
    .run(
      project.id,
      project.label,
      project.root,
      "repo" in project ? (project.repo ?? null) : null,
      lastSeenAt,
    );
}

function upsertWorktree(database: DatabaseSync, worktree: WorktreeObservation): void {
  database
    .prepare(
      `
        INSERT INTO worktrees
          (id, project_id, path, branch, source, state, dirty, provider, provider_data_json, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          path = excluded.path,
          branch = excluded.branch,
          source = excluded.source,
          state = excluded.state,
          dirty = excluded.dirty,
          provider = excluded.provider,
          provider_data_json = excluded.provider_data_json,
          last_seen_at = excluded.last_seen_at
      `,
    )
    .run(
      worktree.id,
      worktree.projectId,
      worktree.path,
      worktree.branch,
      worktree.source,
      worktree.state,
      worktree.dirty === undefined ? null : Number(worktree.dirty),
      worktree.provider,
      optionalJson(worktree.providerData),
      worktree.observedAt,
    );
}

function upsertTerminalTarget(database: DatabaseSync, target: TerminalTargetObservation): void {
  database
    .prepare(
      `
        INSERT INTO terminal_targets
          (id, session_id, project_id, worktree_id, provider, state, provider_key, provider_data_json, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          project_id = excluded.project_id,
          worktree_id = excluded.worktree_id,
          provider = excluded.provider,
          state = excluded.state,
          provider_key = excluded.provider_key,
          provider_data_json = excluded.provider_data_json,
          last_seen_at = excluded.last_seen_at
      `,
    )
    .run(
      target.id,
      target.sessionId ?? null,
      target.projectId ?? null,
      target.worktreeId ?? null,
      target.provider,
      target.state,
      target.id,
      optionalJson(target.providerData),
      target.observedAt,
    );
}

function upsertHarnessRun(database: DatabaseSync, run: HarnessRunObservation): void {
  database
    .prepare(
      `
        INSERT INTO harness_runs
          (id, session_id, project_id, worktree_id, harness, pid, external_run_id, state, confidence, reason, provider_data_json, last_event_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          project_id = excluded.project_id,
          worktree_id = excluded.worktree_id,
          harness = excluded.harness,
          pid = excluded.pid,
          external_run_id = excluded.external_run_id,
          state = excluded.state,
          confidence = excluded.confidence,
          reason = excluded.reason,
          provider_data_json = excluded.provider_data_json,
          last_event_at = excluded.last_event_at,
          last_seen_at = excluded.last_seen_at
      `,
    )
    .run(
      run.id,
      run.sessionId ?? null,
      run.projectId ?? null,
      run.worktreeId ?? null,
      run.provider,
      run.pid ?? null,
      run.id,
      run.state,
      run.confidence,
      run.reason,
      optionalJson(run.providerData),
      run.observedAt,
      run.observedAt,
    );
}

function upsertSessions(
  database: DatabaseSync,
  terminalTargets: TerminalTargetObservation[],
  harnessRuns: HarnessRunObservation[],
): void {
  // Sessions are reconstructed from two partial truths: terminal bindings identify
  // the workspace, while harness runs supply agent state.
  const sessions = new Map<string, PersistedSession>();

  for (const target of terminalTargets) {
    if (
      target.sessionId === undefined ||
      target.projectId === undefined ||
      target.worktreeId === undefined
    ) {
      continue;
    }
    sessions.set(target.sessionId, {
      id: target.sessionId,
      projectId: target.projectId,
      worktreeId: target.worktreeId,
      terminalProvider: target.provider,
      state: target.state,
      createdAt: target.observedAt,
      lastSeenAt: target.observedAt,
    });
  }

  for (const run of harnessRuns) {
    if (
      run.sessionId === undefined ||
      run.projectId === undefined ||
      run.worktreeId === undefined
    ) {
      continue;
    }
    const existing = sessions.get(run.sessionId);
    sessions.set(run.sessionId, {
      id: run.sessionId,
      projectId: run.projectId,
      worktreeId: run.worktreeId,
      ...(existing?.terminalProvider === undefined
        ? {}
        : { terminalProvider: existing.terminalProvider }),
      harness: run.provider,
      state: run.state,
      createdAt: existing?.createdAt ?? run.observedAt,
      lastSeenAt: maxIso(existing?.lastSeenAt, run.observedAt),
    });
  }

  for (const session of sessions.values()) {
    database
      .prepare(
        `
          INSERT INTO sessions
            (id, project_id, worktree_id, harness, terminal_provider, state, created_at, ended_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
          ON CONFLICT(id) DO UPDATE SET
            project_id = excluded.project_id,
            worktree_id = excluded.worktree_id,
            harness = COALESCE(excluded.harness, sessions.harness),
            terminal_provider = COALESCE(excluded.terminal_provider, sessions.terminal_provider),
            state = excluded.state,
            last_seen_at = excluded.last_seen_at
        `,
      )
      .run(
        session.id,
        session.projectId,
        session.worktreeId,
        session.harness ?? null,
        session.terminalProvider ?? null,
        session.state ?? null,
        session.createdAt,
        session.lastSeenAt,
      );
  }
}
