import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type CommandId,
  type ErrorEnvelope,
  ErrorEnvelopeSchema,
  type HarnessRunObservation,
  HarnessRunObservationSchema,
  type ProviderHealth,
  type ProviderId,
  type ProviderProjectConfig,
  type SafeError,
  SafeErrorSchema,
  type TerminalTargetObservation,
  TerminalTargetObservationSchema,
  type WorktreeObservation,
  WorktreeObservationSchema,
  type WosmCommand,
  WosmCommandSchema,
  type WosmEvent,
  WosmEventSchema,
} from "@wosm/contracts";
import { Effect, type RuntimeClock, systemClock, toIsoTimestamp } from "@wosm/runtime";
import { type ObserverSqliteHandle, runSqliteTransactionEffect } from "./sqlite";

export type PersistedCommandStatus = "accepted" | "started" | "succeeded" | "failed";

export type ObserverIdFactory = {
  commandId(): string;
  eventId(): string;
  errorId(): string;
  observationId(): string;
  breadcrumbId(): string;
};

export type PersistedCommand = {
  id: CommandId;
  type: WosmCommand["type"];
  command: WosmCommand;
  status: PersistedCommandStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: SafeError;
};

export type PersistedEvent = {
  id: string;
  type: WosmEvent["type"];
  source: string;
  event: WosmEvent;
  createdAt: string;
  commandId?: CommandId;
};

export type PersistedCommandError = {
  id: string;
  commandId: CommandId;
  envelope: ErrorEnvelope;
  createdAt: string;
};

export type ProviderObservationKind =
  | "worktree"
  | "terminal_target"
  | "harness_run"
  | "provider_health";

export type ProviderObservationType = "worktree" | "terminal" | "harness" | "observer";

export type PersistedProviderObservation = {
  id: string;
  provider: ProviderId;
  providerType: ProviderObservationType;
  entityKind: ProviderObservationKind;
  entityKey: string;
  payload: unknown;
  observedAt: string;
  expiresAt?: string | undefined;
  expired: boolean;
};

export type PersistedProject = {
  id: string;
  label: string;
  root: string;
  repo?: string;
  lastSeenAt: string;
};

export type PersistedWorktree = {
  id: string;
  projectId: string;
  path: string;
  branch?: string;
  source?: string;
  state?: string;
  dirty?: boolean;
  provider?: string;
  providerData?: unknown;
  lastSeenAt: string;
};

export type PersistedTerminalTarget = {
  id: string;
  sessionId?: string;
  projectId?: string;
  worktreeId?: string;
  provider: string;
  state?: string;
  providerKey?: string;
  providerData?: unknown;
  lastSeenAt: string;
};

export type PersistedHarnessRun = {
  id: string;
  sessionId?: string;
  projectId?: string;
  worktreeId?: string;
  harness: string;
  pid?: number;
  externalRunId?: string;
  state?: string;
  confidence?: string;
  reason?: string;
  providerData?: unknown;
  lastEventAt?: string;
  lastSeenAt: string;
};

export type PersistedSession = {
  id: string;
  projectId: string;
  worktreeId: string;
  harness?: string;
  terminalProvider?: string;
  state?: string;
  createdAt: string;
  endedAt?: string;
  lastSeenAt: string;
};

export type PersistedRecoveryBreadcrumb = {
  id: string;
  projectId: string;
  worktreeId?: string;
  sessionId?: string;
  location: string;
  path: string;
  payload: unknown;
  createdAt: string;
  lastSeenAt: string;
};

export type PersistReconcileResultInput = {
  projects: ProviderProjectConfig[];
  worktrees: WorktreeObservation[];
  terminalTargets: TerminalTargetObservation[];
  harnessRuns: HarnessRunObservation[];
  providerHealth?: Record<string, ProviderHealth>;
  observedAt?: string;
  expiresAt?: string | undefined;
};

export type ObserverPersistence = {
  recordCommandAccepted(input: {
    commandId: CommandId;
    command: WosmCommand;
    createdAt?: string;
  }): Promise<PersistedCommand>;
  markCommandStarted(commandId: CommandId, startedAt?: string): Promise<PersistedCommand>;
  markCommandSucceeded(commandId: CommandId, finishedAt?: string): Promise<PersistedCommand>;
  markCommandFailed(input: {
    commandId: CommandId;
    safeError: SafeError;
    envelope: ErrorEnvelope;
    finishedAt?: string;
  }): Promise<PersistedCommand>;
  getCommand(commandId: CommandId): Promise<PersistedCommand | undefined>;
  listCommands(): Promise<PersistedCommand[]>;
  listCommandErrors(commandId?: CommandId): Promise<PersistedCommandError[]>;
  recordEvent(
    event: WosmEvent,
    options?: { source?: string; commandId?: CommandId; createdAt?: string },
  ): Promise<PersistedEvent>;
  listEvents(filter?: {
    commandId?: CommandId;
    type?: WosmEvent["type"];
  }): Promise<PersistedEvent[]>;
  recordProviderObservation(input: {
    provider: ProviderId;
    providerType: ProviderObservationType;
    entityKind: ProviderObservationKind;
    entityKey: string;
    payload: unknown;
    observedAt?: string;
    expiresAt?: string | undefined;
  }): Promise<PersistedProviderObservation>;
  listProviderObservations(options?: {
    includeExpired?: boolean;
    now?: string;
  }): Promise<PersistedProviderObservation[]>;
  pruneExpiredProviderObservations(now?: string): Promise<number>;
  persistReconcileResult(input: PersistReconcileResultInput): Promise<void>;
  listProjects(): Promise<PersistedProject[]>;
  listWorktrees(): Promise<PersistedWorktree[]>;
  listTerminalTargets(): Promise<PersistedTerminalTarget[]>;
  listHarnessRuns(): Promise<PersistedHarnessRun[]>;
  listSessions(): Promise<PersistedSession[]>;
  recordRecoveryBreadcrumb(input: {
    projectId: string;
    location: string;
    path: string;
    payload: unknown;
    worktreeId?: string;
    sessionId?: string;
    createdAt?: string;
    lastSeenAt?: string;
  }): Promise<PersistedRecoveryBreadcrumb>;
  listRecoveryBreadcrumbs(): Promise<PersistedRecoveryBreadcrumb[]>;
};

export type CreateObserverPersistenceOptions = {
  sqlite: ObserverSqliteHandle;
  clock?: RuntimeClock;
  idFactory?: Partial<ObserverIdFactory>;
};

const defaultIdFactory: ObserverIdFactory = {
  commandId: () => `cmd_${randomUUID()}`,
  eventId: () => `evt_${randomUUID()}`,
  errorId: () => `err_${randomUUID()}`,
  observationId: () => `obs_${randomUUID()}`,
  breadcrumbId: () => `crumb_${randomUUID()}`,
};

export function createObserverPersistence(
  options: CreateObserverPersistenceOptions,
): ObserverPersistence {
  const clock = options.clock ?? systemClock;
  const idFactory = { ...defaultIdFactory, ...options.idFactory };
  const now = () => toIsoTimestamp(clock.now());
  const transaction = <T>(task: (database: DatabaseSync) => T): Promise<T> =>
    Effect.runPromise(runSqliteTransactionEffect(options.sqlite, task));

  return {
    recordCommandAccepted: (input) =>
      transaction((database) => {
        const command = WosmCommandSchema.parse(input.command);
        const createdAt = input.createdAt ?? now();
        database
          .prepare(
            `
              INSERT INTO commands (id, type, payload_json, status, created_at)
              VALUES (?, ?, ?, 'accepted', ?)
            `,
          )
          .run(input.commandId, command.type, stringifyJson(command), createdAt);
        return readCommand(database, input.commandId);
      }),

    markCommandStarted: (commandId, startedAt) =>
      transaction((database) => {
        database
          .prepare("UPDATE commands SET status = 'started', started_at = ? WHERE id = ?")
          .run(startedAt ?? now(), commandId);
        return readCommand(database, commandId);
      }),

    markCommandSucceeded: (commandId, finishedAt) =>
      transaction((database) => {
        database
          .prepare(
            "UPDATE commands SET status = 'succeeded', finished_at = ?, error_json = NULL WHERE id = ?",
          )
          .run(finishedAt ?? now(), commandId);
        return readCommand(database, commandId);
      }),

    markCommandFailed: (input) =>
      transaction((database) => {
        const safeError = SafeErrorSchema.parse(input.safeError);
        const envelope = ErrorEnvelopeSchema.parse(input.envelope);
        const finishedAt = input.finishedAt ?? now();
        database
          .prepare(
            "UPDATE commands SET status = 'failed', finished_at = ?, error_json = ? WHERE id = ?",
          )
          .run(finishedAt, stringifyJson(safeError), input.commandId);
        database
          .prepare(
            `
              INSERT OR REPLACE INTO command_errors (id, command_id, envelope_json, created_at)
              VALUES (?, ?, ?, ?)
            `,
          )
          .run(envelope.id, input.commandId, stringifyJson(envelope), envelope.createdAt);
        return readCommand(database, input.commandId);
      }),

    getCommand: (commandId) =>
      transaction((database) => {
        const row = getCommandRow(database, commandId);
        return row === undefined ? undefined : commandFromRow(row);
      }),

    listCommands: () =>
      transaction((database) =>
        (
          database.prepare("SELECT * FROM commands ORDER BY created_at, id").all() as CommandRow[]
        ).map(commandFromRow),
      ),

    listCommandErrors: (commandId) =>
      transaction((database) => {
        const rows =
          commandId === undefined
            ? (database
                .prepare("SELECT * FROM command_errors ORDER BY created_at, id")
                .all() as CommandErrorRow[])
            : (database
                .prepare(
                  "SELECT * FROM command_errors WHERE command_id = ? ORDER BY created_at, id",
                )
                .all(commandId) as CommandErrorRow[]);
        return rows.map(commandErrorFromRow);
      }),

    recordEvent: (event, eventOptions = {}) =>
      transaction((database) => {
        const parsedEvent = WosmEventSchema.parse(event);
        const eventId = idFactory.eventId();
        const createdAt = eventOptions.createdAt ?? eventTimestamp(parsedEvent) ?? now();
        const commandId = eventOptions.commandId ?? eventCommandId(parsedEvent);
        database
          .prepare(
            `
              INSERT INTO events (id, type, source, command_id, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            eventId,
            parsedEvent.type,
            eventOptions.source ?? "observer",
            commandId ?? null,
            stringifyJson(parsedEvent),
            createdAt,
          );
        return readEvent(database, eventId);
      }),

    listEvents: (filter = {}) =>
      transaction((database) =>
        (database.prepare("SELECT * FROM events ORDER BY created_at, id").all() as EventRow[])
          .map(eventFromRow)
          .filter((event) => filter.commandId === undefined || event.commandId === filter.commandId)
          .filter((event) => filter.type === undefined || event.type === filter.type),
      ),

    recordProviderObservation: (input) =>
      transaction((database) =>
        insertProviderObservation(database, {
          ...input,
          id: idFactory.observationId(),
          observedAt: input.observedAt ?? now(),
        }),
      ),

    listProviderObservations: (listOptions = {}) =>
      transaction((database) => {
        const referenceTime = listOptions.now ?? now();
        const observations = (
          database
            .prepare("SELECT * FROM provider_observations ORDER BY observed_at, id")
            .all() as ProviderObservationRow[]
        ).map((row) => providerObservationFromRow(row, referenceTime));
        return listOptions.includeExpired === true
          ? observations
          : observations.filter((observation) => !observation.expired);
      }),

    pruneExpiredProviderObservations: (expiresBefore) =>
      transaction((database) => {
        const result = database
          .prepare(
            "DELETE FROM provider_observations WHERE expires_at IS NOT NULL AND expires_at <= ?",
          )
          .run(expiresBefore ?? now());
        return Number(result.changes);
      }),

    persistReconcileResult: (input) =>
      transaction((database) => {
        const observedAt = input.observedAt ?? now();
        for (const project of input.projects) {
          upsertProject(database, project, observedAt);
        }
        for (const worktree of input.worktrees.map((value) =>
          WorktreeObservationSchema.parse(value),
        )) {
          upsertWorktree(database, worktree);
          insertProviderObservation(database, {
            id: idFactory.observationId(),
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
            id: idFactory.observationId(),
            provider: target.provider,
            providerType: "terminal",
            entityKind: "terminal_target",
            entityKey: target.id,
            payload: target,
            observedAt: target.observedAt,
            expiresAt: input.expiresAt,
          });
        }
        for (const run of input.harnessRuns.map((value) =>
          HarnessRunObservationSchema.parse(value),
        )) {
          upsertHarnessRun(database, run);
          insertProviderObservation(database, {
            id: idFactory.observationId(),
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
              id: idFactory.observationId(),
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
      }),

    listProjects: () =>
      transaction((database) =>
        (database.prepare("SELECT * FROM projects ORDER BY id").all() as ProjectRow[]).map(
          projectFromRow,
        ),
      ),

    listWorktrees: () =>
      transaction((database) =>
        (database.prepare("SELECT * FROM worktrees ORDER BY id").all() as WorktreeRow[]).map(
          worktreeFromRow,
        ),
      ),

    listTerminalTargets: () =>
      transaction((database) =>
        (
          database
            .prepare("SELECT * FROM terminal_targets ORDER BY id")
            .all() as TerminalTargetRow[]
        ).map(terminalTargetFromRow),
      ),

    listHarnessRuns: () =>
      transaction((database) =>
        (database.prepare("SELECT * FROM harness_runs ORDER BY id").all() as HarnessRunRow[]).map(
          harnessRunFromRow,
        ),
      ),

    listSessions: () =>
      transaction((database) =>
        (database.prepare("SELECT * FROM sessions ORDER BY id").all() as SessionRow[]).map(
          sessionFromRow,
        ),
      ),

    recordRecoveryBreadcrumb: (input) =>
      transaction((database) => {
        const id = idFactory.breadcrumbId();
        const createdAt = input.createdAt ?? now();
        const lastSeenAt = input.lastSeenAt ?? createdAt;
        database
          .prepare(
            `
              INSERT OR REPLACE INTO recovery_breadcrumbs
                (id, project_id, worktree_id, session_id, location, path, payload_json, created_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            id,
            input.projectId,
            input.worktreeId ?? null,
            input.sessionId ?? null,
            input.location,
            input.path,
            stringifyJson(input.payload),
            createdAt,
            lastSeenAt,
          );
        return readRecoveryBreadcrumb(database, id);
      }),

    listRecoveryBreadcrumbs: () =>
      transaction((database) =>
        (
          database
            .prepare("SELECT * FROM recovery_breadcrumbs ORDER BY last_seen_at, id")
            .all() as RecoveryBreadcrumbRow[]
        ).map(recoveryBreadcrumbFromRow),
      ),
  };
}

type CommandRow = {
  id: string;
  type: WosmCommand["type"];
  payload_json: string;
  status: PersistedCommandStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_json: string | null;
};

type CommandErrorRow = {
  id: string;
  command_id: string;
  envelope_json: string;
  created_at: string;
};

type EventRow = {
  id: string;
  type: WosmEvent["type"];
  source: string;
  command_id: string | null;
  payload_json: string;
  created_at: string;
};

type ProviderObservationRow = {
  id: string;
  provider: string;
  provider_type: ProviderObservationType;
  entity_kind: ProviderObservationKind;
  entity_key: string;
  payload_json: string;
  observed_at: string;
  expires_at: string | null;
};

type ProjectRow = {
  id: string;
  label: string;
  root: string;
  repo: string | null;
  last_seen_at: string;
};

type WorktreeRow = {
  id: string;
  project_id: string;
  path: string;
  branch: string | null;
  source: string | null;
  state: string | null;
  dirty: number | null;
  provider: string | null;
  provider_data_json: string | null;
  last_seen_at: string;
};

type TerminalTargetRow = {
  id: string;
  session_id: string | null;
  project_id: string | null;
  worktree_id: string | null;
  provider: string;
  state: string | null;
  provider_key: string | null;
  provider_data_json: string | null;
  last_seen_at: string;
};

type HarnessRunRow = {
  id: string;
  session_id: string | null;
  project_id: string | null;
  worktree_id: string | null;
  harness: string;
  pid: number | null;
  external_run_id: string | null;
  state: string | null;
  confidence: string | null;
  reason: string | null;
  provider_data_json: string | null;
  last_event_at: string | null;
  last_seen_at: string;
};

type SessionRow = {
  id: string;
  project_id: string;
  worktree_id: string;
  harness: string | null;
  terminal_provider: string | null;
  state: string | null;
  created_at: string;
  ended_at: string | null;
  last_seen_at: string;
};

type RecoveryBreadcrumbRow = {
  id: string;
  project_id: string;
  worktree_id: string | null;
  session_id: string | null;
  location: string;
  path: string;
  payload_json: string;
  created_at: string;
  last_seen_at: string;
};

function readCommand(database: DatabaseSync, commandId: string): PersistedCommand {
  const row = getCommandRow(database, commandId);
  if (row === undefined) {
    throw new Error(`Command ${commandId} was not found.`);
  }
  return commandFromRow(row);
}

function getCommandRow(database: DatabaseSync, commandId: string): CommandRow | undefined {
  return database.prepare("SELECT * FROM commands WHERE id = ?").get(commandId) as
    | CommandRow
    | undefined;
}

function commandFromRow(row: CommandRow): PersistedCommand {
  const command = WosmCommandSchema.parse(parseJson(row.payload_json));
  return {
    id: row.id,
    type: command.type,
    command,
    status: row.status,
    createdAt: row.created_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    ...(row.error_json === null ? {} : { error: SafeErrorSchema.parse(parseJson(row.error_json)) }),
  };
}

function commandErrorFromRow(row: CommandErrorRow): PersistedCommandError {
  return {
    id: row.id,
    commandId: row.command_id,
    envelope: ErrorEnvelopeSchema.parse(parseJson(row.envelope_json)),
    createdAt: row.created_at,
  };
}

function readEvent(database: DatabaseSync, eventId: string): PersistedEvent {
  const row = database.prepare("SELECT * FROM events WHERE id = ?").get(eventId) as EventRow;
  return eventFromRow(row);
}

function eventFromRow(row: EventRow): PersistedEvent {
  const event = WosmEventSchema.parse(parseJson(row.payload_json));
  return {
    id: row.id,
    type: event.type,
    source: row.source,
    event,
    createdAt: row.created_at,
    ...(row.command_id === null ? {} : { commandId: row.command_id }),
  };
}

function eventCommandId(event: WosmEvent): CommandId | undefined {
  return "commandId" in event ? event.commandId : undefined;
}

function eventTimestamp(event: WosmEvent): string | undefined {
  return "at" in event ? event.at : undefined;
}

function insertProviderObservation(
  database: DatabaseSync,
  input: {
    id: string;
    provider: ProviderId;
    providerType: ProviderObservationType;
    entityKind: ProviderObservationKind;
    entityKey: string;
    payload: unknown;
    observedAt: string;
    expiresAt?: string | undefined;
  },
): PersistedProviderObservation {
  const payload = validateProviderObservationPayload(input.entityKind, input.payload);
  database
    .prepare(
      `
        INSERT OR REPLACE INTO provider_observations
          (id, provider, provider_type, entity_kind, entity_key, payload_json, observed_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.id,
      input.provider,
      input.providerType,
      input.entityKind,
      input.entityKey,
      stringifyJson(payload),
      input.observedAt,
      input.expiresAt ?? null,
    );

  return providerObservationFromRow(
    database
      .prepare("SELECT * FROM provider_observations WHERE id = ?")
      .get(input.id) as ProviderObservationRow,
    input.observedAt,
  );
}

function providerObservationFromRow(
  row: ProviderObservationRow,
  referenceTime: string,
): PersistedProviderObservation {
  const expiresAt = row.expires_at ?? undefined;
  return {
    id: row.id,
    provider: row.provider,
    providerType: row.provider_type,
    entityKind: row.entity_kind,
    entityKey: row.entity_key,
    payload: parseJson(row.payload_json),
    observedAt: row.observed_at,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    expired: expiresAt === undefined ? false : Date.parse(expiresAt) <= Date.parse(referenceTime),
  };
}

function validateProviderObservationPayload(
  kind: ProviderObservationKind,
  payload: unknown,
): unknown {
  if (kind === "worktree") {
    return WorktreeObservationSchema.parse(payload);
  }
  if (kind === "terminal_target") {
    return TerminalTargetObservationSchema.parse(payload);
  }
  if (kind === "harness_run") {
    return HarnessRunObservationSchema.parse(payload);
  }
  return payload;
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

function projectFromRow(row: ProjectRow): PersistedProject {
  return {
    id: row.id,
    label: row.label,
    root: row.root,
    ...(row.repo === null ? {} : { repo: row.repo }),
    lastSeenAt: row.last_seen_at,
  };
}

function worktreeFromRow(row: WorktreeRow): PersistedWorktree {
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    ...(row.branch === null ? {} : { branch: row.branch }),
    ...(row.source === null ? {} : { source: row.source }),
    ...(row.state === null ? {} : { state: row.state }),
    ...(row.dirty === null ? {} : { dirty: Boolean(row.dirty) }),
    ...(row.provider === null ? {} : { provider: row.provider }),
    ...(row.provider_data_json === null ? {} : { providerData: parseJson(row.provider_data_json) }),
    lastSeenAt: row.last_seen_at,
  };
}

function terminalTargetFromRow(row: TerminalTargetRow): PersistedTerminalTarget {
  return {
    id: row.id,
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    ...(row.worktree_id === null ? {} : { worktreeId: row.worktree_id }),
    provider: row.provider,
    ...(row.state === null ? {} : { state: row.state }),
    ...(row.provider_key === null ? {} : { providerKey: row.provider_key }),
    ...(row.provider_data_json === null ? {} : { providerData: parseJson(row.provider_data_json) }),
    lastSeenAt: row.last_seen_at,
  };
}

function harnessRunFromRow(row: HarnessRunRow): PersistedHarnessRun {
  return {
    id: row.id,
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    ...(row.worktree_id === null ? {} : { worktreeId: row.worktree_id }),
    harness: row.harness,
    ...(row.pid === null ? {} : { pid: row.pid }),
    ...(row.external_run_id === null ? {} : { externalRunId: row.external_run_id }),
    ...(row.state === null ? {} : { state: row.state }),
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.provider_data_json === null ? {} : { providerData: parseJson(row.provider_data_json) }),
    ...(row.last_event_at === null ? {} : { lastEventAt: row.last_event_at }),
    lastSeenAt: row.last_seen_at,
  };
}

function sessionFromRow(row: SessionRow): PersistedSession {
  return {
    id: row.id,
    projectId: row.project_id,
    worktreeId: row.worktree_id,
    ...(row.harness === null ? {} : { harness: row.harness }),
    ...(row.terminal_provider === null ? {} : { terminalProvider: row.terminal_provider }),
    ...(row.state === null ? {} : { state: row.state }),
    createdAt: row.created_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
    lastSeenAt: row.last_seen_at,
  };
}

function readRecoveryBreadcrumb(
  database: DatabaseSync,
  breadcrumbId: string,
): PersistedRecoveryBreadcrumb {
  return recoveryBreadcrumbFromRow(
    database
      .prepare("SELECT * FROM recovery_breadcrumbs WHERE id = ?")
      .get(breadcrumbId) as RecoveryBreadcrumbRow,
  );
}

function recoveryBreadcrumbFromRow(row: RecoveryBreadcrumbRow): PersistedRecoveryBreadcrumb {
  return {
    id: row.id,
    projectId: row.project_id,
    ...(row.worktree_id === null ? {} : { worktreeId: row.worktree_id }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    location: row.location,
    path: row.path,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function optionalJson(value: unknown): string | null {
  return value === undefined ? null : stringifyJson(value);
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function maxIso(left: string | undefined, right: string): string {
  if (left === undefined) {
    return right;
  }
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
