import type { WosmCommand, WosmEvent } from "@wosm/contracts";
import {
  ErrorEnvelopeSchema,
  SafeErrorSchema,
  WosmCommandSchema,
  WosmEventSchema,
} from "@wosm/contracts";
import { parseJson } from "./json.js";
import type {
  PersistedCommand,
  PersistedCommandError,
  PersistedCommandStatus,
  PersistedEvent,
  PersistedHarnessRun,
  PersistedProject,
  PersistedProviderObservation,
  PersistedRecoveryBreadcrumb,
  PersistedSession,
  PersistedTerminalTarget,
  PersistedWorktree,
  ProviderObservationKind,
  ProviderObservationType,
} from "./types.js";

export type CommandRow = {
  id: string;
  type: WosmCommand["type"];
  payload_json: string;
  status: PersistedCommandStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  trace_id: string | null;
  span_id: string | null;
  error_json: string | null;
};

export type CommandErrorRow = {
  id: string;
  command_id: string;
  envelope_json: string;
  created_at: string;
};

export type EventRow = {
  id: string;
  type: WosmEvent["type"];
  source: string;
  command_id: string | null;
  trace_id: string | null;
  span_id: string | null;
  payload_json: string;
  created_at: string;
};

export type ProviderObservationRow = {
  id: string;
  provider: string;
  provider_type: ProviderObservationType;
  entity_kind: ProviderObservationKind;
  entity_key: string;
  payload_json: string;
  observed_at: string;
  expires_at: string | null;
};

export type ProjectRow = {
  id: string;
  label: string;
  root: string;
  repo: string | null;
  last_seen_at: string;
};

export type WorktreeRow = {
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

export type TerminalTargetRow = {
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

export type HarnessRunRow = {
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

export type SessionRow = {
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

export type RecoveryBreadcrumbRow = {
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

export function commandFromRow(row: CommandRow): PersistedCommand {
  const command = WosmCommandSchema.parse(parseJson(row.payload_json));
  const persistedCommand: PersistedCommand = {
    id: row.id,
    type: command.type,
    command,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.started_at !== null) persistedCommand.startedAt = row.started_at;
  if (row.finished_at !== null) persistedCommand.finishedAt = row.finished_at;
  if (row.trace_id !== null) persistedCommand.traceId = row.trace_id;
  if (row.span_id !== null) persistedCommand.spanId = row.span_id;
  if (row.error_json !== null) {
    persistedCommand.error = SafeErrorSchema.parse(parseJson(row.error_json));
  }
  return persistedCommand;
}

export function commandErrorFromRow(row: CommandErrorRow): PersistedCommandError {
  return {
    id: row.id,
    commandId: row.command_id,
    envelope: ErrorEnvelopeSchema.parse(parseJson(row.envelope_json)),
    createdAt: row.created_at,
  };
}

export function eventFromRow(row: EventRow): PersistedEvent {
  const event = WosmEventSchema.parse(parseJson(row.payload_json));
  const persistedEvent: PersistedEvent = {
    id: row.id,
    type: event.type,
    source: row.source,
    event,
    createdAt: row.created_at,
  };
  if (row.command_id !== null) persistedEvent.commandId = row.command_id;
  if (row.trace_id !== null) persistedEvent.traceId = row.trace_id;
  if (row.span_id !== null) persistedEvent.spanId = row.span_id;
  return persistedEvent;
}

export function providerObservationFromRow(
  row: ProviderObservationRow,
  referenceTime: string,
): PersistedProviderObservation {
  const expiresAt = row.expires_at ?? undefined;
  const observation: PersistedProviderObservation = {
    id: row.id,
    provider: row.provider,
    providerType: row.provider_type,
    entityKind: row.entity_kind,
    entityKey: row.entity_key,
    payload: parseJson(row.payload_json),
    observedAt: row.observed_at,
    expired: expiresAt === undefined ? false : Date.parse(expiresAt) <= Date.parse(referenceTime),
  };
  if (expiresAt !== undefined) observation.expiresAt = expiresAt;
  return observation;
}

export function projectFromRow(row: ProjectRow): PersistedProject {
  const project: PersistedProject = {
    id: row.id,
    label: row.label,
    root: row.root,
    lastSeenAt: row.last_seen_at,
  };
  if (row.repo !== null) project.repo = row.repo;
  return project;
}

export function worktreeFromRow(row: WorktreeRow): PersistedWorktree {
  const worktree: PersistedWorktree = {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    lastSeenAt: row.last_seen_at,
  };
  if (row.branch !== null) worktree.branch = row.branch;
  if (row.source !== null) worktree.source = row.source;
  if (row.state !== null) worktree.state = row.state;
  if (row.dirty !== null) worktree.dirty = Boolean(row.dirty);
  if (row.provider !== null) worktree.provider = row.provider;
  if (row.provider_data_json !== null) worktree.providerData = parseJson(row.provider_data_json);
  return worktree;
}

export function terminalTargetFromRow(row: TerminalTargetRow): PersistedTerminalTarget {
  const target: PersistedTerminalTarget = {
    id: row.id,
    provider: row.provider,
    lastSeenAt: row.last_seen_at,
  };
  if (row.session_id !== null) target.sessionId = row.session_id;
  if (row.project_id !== null) target.projectId = row.project_id;
  if (row.worktree_id !== null) target.worktreeId = row.worktree_id;
  if (row.state !== null) target.state = row.state;
  if (row.provider_key !== null) target.providerKey = row.provider_key;
  if (row.provider_data_json !== null) target.providerData = parseJson(row.provider_data_json);
  return target;
}

export function harnessRunFromRow(row: HarnessRunRow): PersistedHarnessRun {
  const harnessRun: PersistedHarnessRun = {
    id: row.id,
    harness: row.harness,
    lastSeenAt: row.last_seen_at,
  };
  if (row.session_id !== null) harnessRun.sessionId = row.session_id;
  if (row.project_id !== null) harnessRun.projectId = row.project_id;
  if (row.worktree_id !== null) harnessRun.worktreeId = row.worktree_id;
  if (row.pid !== null) harnessRun.pid = row.pid;
  if (row.external_run_id !== null) harnessRun.externalRunId = row.external_run_id;
  if (row.state !== null) harnessRun.state = row.state;
  if (row.confidence !== null) harnessRun.confidence = row.confidence;
  if (row.reason !== null) harnessRun.reason = row.reason;
  if (row.provider_data_json !== null) {
    harnessRun.providerData = parseJson(row.provider_data_json);
  }
  if (row.last_event_at !== null) harnessRun.lastEventAt = row.last_event_at;
  return harnessRun;
}

export function sessionFromRow(row: SessionRow): PersistedSession {
  const session: PersistedSession = {
    id: row.id,
    projectId: row.project_id,
    worktreeId: row.worktree_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
  if (row.harness !== null) session.harness = row.harness;
  if (row.terminal_provider !== null) session.terminalProvider = row.terminal_provider;
  if (row.state !== null) session.state = row.state;
  if (row.ended_at !== null) session.endedAt = row.ended_at;
  return session;
}

export function recoveryBreadcrumbFromRow(row: RecoveryBreadcrumbRow): PersistedRecoveryBreadcrumb {
  const breadcrumb: PersistedRecoveryBreadcrumb = {
    id: row.id,
    projectId: row.project_id,
    location: row.location,
    path: row.path,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
  if (row.worktree_id !== null) breadcrumb.worktreeId = row.worktree_id;
  if (row.session_id !== null) breadcrumb.sessionId = row.session_id;
  return breadcrumb;
}
