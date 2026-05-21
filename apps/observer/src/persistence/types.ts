import type {
  CommandId,
  ErrorEnvelope,
  HarnessRunObservation,
  ProviderHealth,
  ProviderId,
  ProviderProjectConfig,
  SafeError,
  TerminalTargetObservation,
  WorktreeObservation,
  WosmCommand,
  WosmEvent,
} from "@wosm/contracts";
import type { RuntimeClock } from "@wosm/runtime";
import type { ObserverSqliteHandle } from "../sqlite.js";

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
  traceId?: string;
  spanId?: string;
  error?: SafeError;
};

export type PersistedEvent = {
  id: string;
  type: WosmEvent["type"];
  source: string;
  event: WosmEvent;
  createdAt: string;
  commandId?: CommandId;
  traceId?: string;
  spanId?: string;
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
    traceId?: string;
    spanId?: string;
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
    options?: {
      source?: string;
      commandId?: CommandId;
      traceId?: string;
      spanId?: string;
      createdAt?: string;
    },
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
