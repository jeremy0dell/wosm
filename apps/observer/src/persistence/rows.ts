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
  return {
    id: row.id,
    type: event.type,
    source: row.source,
    event,
    createdAt: row.created_at,
    ...(row.command_id === null ? {} : { commandId: row.command_id }),
  };
}

export function providerObservationFromRow(
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

export function projectFromRow(row: ProjectRow): PersistedProject {
  return {
    id: row.id,
    label: row.label,
    root: row.root,
    ...(row.repo === null ? {} : { repo: row.repo }),
    lastSeenAt: row.last_seen_at,
  };
}

export function worktreeFromRow(row: WorktreeRow): PersistedWorktree {
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

export function terminalTargetFromRow(row: TerminalTargetRow): PersistedTerminalTarget {
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

export function harnessRunFromRow(row: HarnessRunRow): PersistedHarnessRun {
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

export function sessionFromRow(row: SessionRow): PersistedSession {
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

export function recoveryBreadcrumbFromRow(row: RecoveryBreadcrumbRow): PersistedRecoveryBreadcrumb {
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
