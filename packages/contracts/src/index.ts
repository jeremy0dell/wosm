import { z } from "zod";

export const WOSM_SCHEMA_VERSION = "0.3.0" as const;

const nonEmptyStringSchema = z.string().min(1);
const safeTextSchema = nonEmptyStringSchema.refine(
  (value) => !/\n\s*at\s+\S+/.test(value),
  "must not contain stack trace frames",
);
const timestampSchema = z.string().datetime({ offset: true });
const optionalProviderDataSchema = z.unknown().optional();

export const SchemaVersionSchema = z.literal(WOSM_SCHEMA_VERSION);

export const ProjectIdSchema = nonEmptyStringSchema;
export const WorktreeIdSchema = nonEmptyStringSchema;
export const SessionIdSchema = nonEmptyStringSchema;
export const TerminalTargetIdSchema = nonEmptyStringSchema;
export const HarnessRunIdSchema = nonEmptyStringSchema;
export const CommandIdSchema = nonEmptyStringSchema;
export const EventIdSchema = nonEmptyStringSchema;
export const ProviderIdSchema = nonEmptyStringSchema;
export const TimestampSchema = timestampSchema;

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type WorktreeId = z.infer<typeof WorktreeIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type TerminalTargetId = z.infer<typeof TerminalTargetIdSchema>;
export type HarnessRunId = z.infer<typeof HarnessRunIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export const WorktreeStateSchema = z.enum(["exists", "missing", "orphaned"]);
export const TerminalStateSchema = z.enum(["none", "open", "detached", "stale", "unknown"]);
export const AgentStateSchema = z.enum([
  "none",
  "starting",
  "idle",
  "working",
  "needs_attention",
  "stuck",
  "exited",
  "unknown",
]);
export const ObservedStatusSourceSchema = z.enum([
  "harness_hook",
  "harness_process",
  "terminal_capture",
  "worktree_provider",
  "observer_command",
  "reconcile",
  "unknown",
]);
export const ProviderTypeSchema = z.enum(["worktree", "terminal", "harness"]);
export const ProviderHealthStatusSchema = z.enum(["healthy", "degraded", "unavailable", "unknown"]);
export const ErrorSeveritySchema = z.enum(["debug", "info", "warn", "error", "fatal"]);

export type Confidence = z.infer<typeof ConfidenceSchema>;
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;
export type TerminalState = z.infer<typeof TerminalStateSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type ObservedStatusSource = z.infer<typeof ObservedStatusSourceSchema>;

export const SafeErrorSchema = z
  .object({
    tag: nonEmptyStringSchema,
    code: nonEmptyStringSchema,
    message: safeTextSchema,
    hint: safeTextSchema.optional(),
    commandId: CommandIdSchema.optional(),
    projectId: ProjectIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    provider: ProviderIdSchema.optional(),
    traceId: nonEmptyStringSchema.optional(),
    diagnosticId: nonEmptyStringSchema.optional(),
  })
  .strict();

export type SafeError = z.infer<typeof SafeErrorSchema>;

export const ErrorEnvelopeSchema = z
  .object({
    id: nonEmptyStringSchema,
    tag: nonEmptyStringSchema,
    code: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    severity: ErrorSeveritySchema,
    commandId: CommandIdSchema.optional(),
    traceId: nonEmptyStringSchema.optional(),
    spanId: nonEmptyStringSchema.optional(),
    projectId: ProjectIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    provider: ProviderIdSchema.optional(),
    cause: z.unknown().optional(),
    stack: z.string().optional(),
    raw: z.unknown().optional(),
    redacted: z.boolean(),
    createdAt: TimestampSchema,
  })
  .strict();

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const ProviderHealthSchema = z
  .object({
    providerId: ProviderIdSchema,
    providerType: ProviderTypeSchema,
    status: ProviderHealthStatusSchema,
    lastCheckedAt: TimestampSchema,
    lastError: SafeErrorSchema.optional(),
    latencyMs: z.number().nonnegative().optional(),
    capabilities: z.record(nonEmptyStringSchema, z.boolean()).optional(),
  })
  .strict();

export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const WorktreeCapabilitiesSchema = z
  .object({
    canCreate: z.boolean(),
    canRemove: z.boolean(),
    canList: z.boolean(),
    canEmitLifecycleEvents: z.boolean(),
    canExposeDirtyState: z.boolean(),
  })
  .strict();

export type WorktreeCapabilities = z.infer<typeof WorktreeCapabilitiesSchema>;

export const TerminalCapabilitiesSchema = z
  .object({
    canOpenWorkspace: z.boolean(),
    canFocusTarget: z.boolean(),
    canCloseTarget: z.boolean(),
    canCaptureOutput: z.boolean(),
    canSendInput: z.boolean(),
    canPersistIdentityBinding: z.boolean(),
    canDisplayPopup: z.boolean(),
  })
  .strict();

export type TerminalCapabilities = z.infer<typeof TerminalCapabilitiesSchema>;

export const HarnessCapabilitiesSchema = z
  .object({
    canLaunch: z.boolean(),
    canDiscoverRuns: z.boolean(),
    canEmitEvents: z.boolean(),
    canClassifyStatus: z.boolean(),
    canReceivePrompt: z.boolean(),
    canResume: z.boolean(),
    canStop: z.boolean(),
    canRunNonInteractive: z.boolean(),
    canExposeApprovalState: z.boolean(),
  })
  .strict();

export type HarnessCapabilities = z.infer<typeof HarnessCapabilitiesSchema>;

export type ProviderProjectConfig = {
  id: ProjectId;
  label: string;
  root: string;
  defaults: {
    harness: ProviderId;
    terminal: ProviderId;
    layout: string;
  };
  worktrunk: {
    enabled: boolean;
    base?: string;
  };
};

export type CreateWorktreeRequest = {
  project: ProviderProjectConfig;
  branch: string;
  base?: string;
  path?: string;
};

export type RemoveWorktreeRequest = {
  worktreeId: WorktreeId;
  projectId?: ProjectId;
  force?: boolean;
};

export type RemoveWorktreeResult = {
  worktreeId: WorktreeId;
  removed: boolean;
  reason?: string;
};

export type GetWorktreeRequest = {
  worktreeId?: WorktreeId;
  projectId?: ProjectId;
  path?: string;
};

export type OpenWorkspaceRequest = {
  project: ProviderProjectConfig;
  worktree: WorktreeObservation;
  harness: ProviderId;
  layout: string;
  sessionId?: SessionId;
};

export type OpenWorkspaceResult = {
  target: TerminalIdentityBinding;
  agentEndpointId: string;
  providerData?: unknown;
};

export type TerminalCapture = {
  targetId: TerminalTargetId;
  capturedAt: string;
  text: string;
  providerData?: unknown;
};

export type BuildHarnessLaunchRequest = {
  project: ProviderProjectConfig;
  worktree: WorktreeObservation;
  terminalTarget?: TerminalTargetObservation;
  mode?: "interactive" | "exec";
};

export type HarnessLaunchPlan = {
  provider: ProviderId;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  mode: "interactive" | "exec";
  providerData?: unknown;
};

export type HarnessDiscoveryContext = {
  projects: ProviderProjectConfig[];
  worktrees: WorktreeObservation[];
  terminalTargets: TerminalTargetObservation[];
};

export type HarnessClassificationContext = {
  projects: ProviderProjectConfig[];
  worktrees: WorktreeObservation[];
  terminalTargets: TerminalTargetObservation[];
};

export type RawHarnessEvent = {
  provider: ProviderId;
  event: unknown;
  observedAt?: string;
};

export type HarnessEventContext = {
  projects: ProviderProjectConfig[];
  worktrees: WorktreeObservation[];
  terminalTargets: TerminalTargetObservation[];
};

export type HarnessStopRequest = {
  runId: HarnessRunId;
  sessionId?: SessionId;
  force?: boolean;
};

export type HarnessStopResult = {
  runId: HarnessRunId;
  stopped: boolean;
  reason?: string;
};

export interface WorktreeProvider {
  id: ProviderId;
  capabilities(): WorktreeCapabilities;
  health(): Promise<ProviderHealth>;
  listWorktrees(project: ProviderProjectConfig): Promise<WorktreeObservation[]>;
  createWorktree(request: CreateWorktreeRequest): Promise<WorktreeObservation>;
  removeWorktree(request: RemoveWorktreeRequest): Promise<RemoveWorktreeResult>;
  getWorktree?(request: GetWorktreeRequest): Promise<WorktreeObservation | null>;
}

export interface TerminalProvider {
  id: ProviderId;
  capabilities(): TerminalCapabilities;
  health(): Promise<ProviderHealth>;
  listTargets(): Promise<TerminalTargetObservation[]>;
  openWorkspace(request: OpenWorkspaceRequest): Promise<OpenWorkspaceResult>;
  focusTarget(targetId: TerminalTargetId): Promise<void>;
  closeTarget(targetId: TerminalTargetId): Promise<void>;
  captureTarget?(targetId: TerminalTargetId): Promise<TerminalCapture>;
  sendInput?(targetId: TerminalTargetId, input: string): Promise<void>;
}

export interface HarnessProvider {
  id: ProviderId;
  capabilities(): HarnessCapabilities;
  health(): Promise<ProviderHealth>;
  buildLaunch(request: BuildHarnessLaunchRequest): Promise<HarnessLaunchPlan>;
  discoverRuns(context: HarnessDiscoveryContext): Promise<HarnessRunObservation[]>;
  classifyRun(
    run: HarnessRunObservation,
    context: HarnessClassificationContext,
  ): Promise<HarnessStatusObservation>;
  ingestEvent?(
    event: RawHarnessEvent,
    context: HarnessEventContext,
  ): Promise<HarnessEventObservation[]>;
  stop?(request: HarnessStopRequest): Promise<HarnessStopResult>;
}

export const ProjectDefaultsSchema = z
  .object({
    harness: ProviderIdSchema,
    terminal: ProviderIdSchema,
    layout: nonEmptyStringSchema,
  })
  .strict();

export const ProjectViewSchema = z
  .object({
    id: ProjectIdSchema,
    label: nonEmptyStringSchema,
    root: nonEmptyStringSchema,
    defaults: ProjectDefaultsSchema,
    health: ProviderHealthSchema,
    counts: z
      .object({
        worktrees: z.number().int().nonnegative(),
        agents: z.number().int().nonnegative(),
        working: z.number().int().nonnegative(),
        idle: z.number().int().nonnegative(),
        attention: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type ProjectView = z.infer<typeof ProjectViewSchema>;

export const WorktreeSourceSchema = z.enum(["worktrunk", "wosm", "manual", "unknown"]);

export const WorktreePullRequestSchema = z
  .object({
    number: z.number().int().positive(),
    url: z.string().url().optional(),
  })
  .strict();

export const WorktreeRuntimeSchema = z
  .object({
    state: WorktreeStateSchema,
    source: WorktreeSourceSchema,
    dirty: z.boolean().optional(),
    ahead: z.number().int().nonnegative().optional(),
    behind: z.number().int().nonnegative().optional(),
    pr: WorktreePullRequestSchema.optional(),
  })
  .strict();

export const WorktreeTerminalSchema = z
  .object({
    provider: ProviderIdSchema,
    state: TerminalStateSchema,
    workspaceTargetId: TerminalTargetIdSchema.optional(),
    primaryAgentTargetId: TerminalTargetIdSchema.optional(),
    sessionName: nonEmptyStringSchema.optional(),
    windowId: nonEmptyStringSchema.optional(),
    agentEndpointId: nonEmptyStringSchema.optional(),
    attached: z.boolean().optional(),
    lastOutputAt: TimestampSchema.optional(),
  })
  .strict();

export const WorktreeAgentSchema = z
  .object({
    harness: ProviderIdSchema,
    state: AgentStateSchema,
    pid: z.number().int().positive().optional(),
    runId: HarnessRunIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    confidence: ConfidenceSchema,
    reason: nonEmptyStringSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const DisplayStatusLabelSchema = z.enum([
  "no agent",
  "starting",
  "idle",
  "working",
  "needs attention",
  "stuck",
  "exited",
  "unknown",
]);

export const WorktreeDisplaySchema = z
  .object({
    statusLabel: DisplayStatusLabelSchema,
    sortPriority: z.number().int(),
    alert: z.boolean(),
    warning: z.boolean().optional(),
    reason: nonEmptyStringSchema.optional(),
  })
  .strict();

export const WorktreeRowSchema = z
  .object({
    id: WorktreeIdSchema,
    projectId: ProjectIdSchema,
    projectLabel: nonEmptyStringSchema,
    branch: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    worktree: WorktreeRuntimeSchema,
    terminal: WorktreeTerminalSchema.optional(),
    agent: WorktreeAgentSchema.optional(),
    display: WorktreeDisplaySchema,
  })
  .strict();

export const WorktreeViewSchema = WorktreeRowSchema;

export type WorktreeRow = z.infer<typeof WorktreeRowSchema>;
export type WorktreeView = WorktreeRow;

export const ObservedStatusSchema = z
  .object({
    value: AgentStateSchema,
    confidence: ConfidenceSchema,
    reason: nonEmptyStringSchema,
    source: ObservedStatusSourceSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export type ObservedStatus = z.infer<typeof ObservedStatusSchema>;

export const SessionViewSchema = z
  .object({
    id: SessionIdSchema,
    projectId: ProjectIdSchema,
    worktreeId: WorktreeIdSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    harness: z
      .object({
        provider: ProviderIdSchema,
        mode: z.enum(["interactive", "exec", "unknown"]),
        pid: z.number().int().positive().optional(),
        runId: HarnessRunIdSchema.optional(),
        capabilities: HarnessCapabilitiesSchema,
      })
      .strict(),
    terminal: z
      .object({
        provider: ProviderIdSchema,
        exists: z.boolean(),
        workspaceTargetId: TerminalTargetIdSchema.optional(),
        primaryAgentTargetId: TerminalTargetIdSchema.optional(),
        sessionName: nonEmptyStringSchema.optional(),
        sessionId: nonEmptyStringSchema.optional(),
        windowId: nonEmptyStringSchema.optional(),
        agentEndpointId: nonEmptyStringSchema.optional(),
        attached: z.boolean().optional(),
        lastOutputAt: TimestampSchema.optional(),
      })
      .strict(),
    status: ObservedStatusSchema,
    title: nonEmptyStringSchema,
    tags: z.array(nonEmptyStringSchema),
  })
  .strict();

export type SessionView = z.infer<typeof SessionViewSchema>;

export const WosmAlertSchema = z
  .object({
    id: nonEmptyStringSchema,
    severity: z.enum(["info", "warn", "error"]),
    message: safeTextSchema,
    code: nonEmptyStringSchema.optional(),
    projectId: ProjectIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    provider: ProviderIdSchema.optional(),
    createdAt: TimestampSchema,
  })
  .strict();

export type WosmAlert = z.infer<typeof WosmAlertSchema>;

export const OrphanedRuntimeStateSchema = z
  .object({
    id: nonEmptyStringSchema,
    kind: z.enum(["terminal_target", "harness_run", "session"]),
    provider: ProviderIdSchema,
    projectId: ProjectIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    terminalTargetId: TerminalTargetIdSchema.optional(),
    harnessRunId: HarnessRunIdSchema.optional(),
    reason: nonEmptyStringSchema,
    observedAt: TimestampSchema,
    providerData: optionalProviderDataSchema,
  })
  .strict();

export type OrphanedRuntimeState = z.infer<typeof OrphanedRuntimeStateSchema>;

export const WosmSnapshotSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    generatedAt: TimestampSchema,
    observer: z
      .object({
        pid: z.number().int().positive(),
        startedAt: TimestampSchema,
        version: nonEmptyStringSchema,
        healthy: z.boolean(),
      })
      .strict(),
    providerHealth: z.record(ProviderIdSchema, ProviderHealthSchema),
    projects: z.array(ProjectViewSchema),
    rows: z.array(WorktreeRowSchema),
    sessions: z.array(SessionViewSchema),
    counts: z
      .object({
        projects: z.number().int().nonnegative(),
        worktrees: z.number().int().nonnegative(),
        agents: z.number().int().nonnegative(),
        working: z.number().int().nonnegative(),
        idle: z.number().int().nonnegative(),
        attention: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
      })
      .strict(),
    alerts: z.array(WosmAlertSchema),
    orphans: z.array(OrphanedRuntimeStateSchema).optional(),
  })
  .strict();

export type WosmSnapshot = z.infer<typeof WosmSnapshotSchema>;

export const WorktreeObservationSchema = z
  .object({
    id: WorktreeIdSchema,
    provider: ProviderIdSchema,
    projectId: ProjectIdSchema,
    branch: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    state: WorktreeStateSchema,
    source: WorktreeSourceSchema,
    dirty: z.boolean().optional(),
    ahead: z.number().int().nonnegative().optional(),
    behind: z.number().int().nonnegative().optional(),
    pr: WorktreePullRequestSchema.optional(),
    confidence: ConfidenceSchema.optional(),
    reason: nonEmptyStringSchema.optional(),
    observedAt: TimestampSchema,
    providerData: optionalProviderDataSchema,
  })
  .strict();

export type WorktreeObservation = z.infer<typeof WorktreeObservationSchema>;

export const TerminalTargetObservationSchema = z
  .object({
    id: TerminalTargetIdSchema,
    provider: ProviderIdSchema,
    projectId: ProjectIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    harnessRunId: HarnessRunIdSchema.optional(),
    state: TerminalStateSchema,
    cwd: nonEmptyStringSchema.optional(),
    pid: z.number().int().positive().optional(),
    title: nonEmptyStringSchema.optional(),
    confidence: ConfidenceSchema,
    reason: nonEmptyStringSchema,
    observedAt: TimestampSchema,
    providerData: optionalProviderDataSchema,
  })
  .strict();

export type TerminalTargetObservation = z.infer<typeof TerminalTargetObservationSchema>;

export const HarnessRunObservationSchema = z
  .object({
    id: HarnessRunIdSchema,
    provider: ProviderIdSchema,
    projectId: ProjectIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    pid: z.number().int().positive().optional(),
    cwd: nonEmptyStringSchema.optional(),
    state: AgentStateSchema,
    confidence: ConfidenceSchema,
    reason: nonEmptyStringSchema,
    observedAt: TimestampSchema,
    providerData: optionalProviderDataSchema,
  })
  .strict();

export type HarnessRunObservation = z.infer<typeof HarnessRunObservationSchema>;

export const HarnessStatusObservationSchema = z
  .object({
    provider: ProviderIdSchema,
    runId: HarnessRunIdSchema.optional(),
    projectId: ProjectIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    status: ObservedStatusSchema,
    observedAt: TimestampSchema,
    providerData: optionalProviderDataSchema,
  })
  .strict();

export type HarnessStatusObservation = z.infer<typeof HarnessStatusObservationSchema>;

export const HarnessEventObservationSchema = z
  .object({
    provider: ProviderIdSchema,
    sessionId: SessionIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    harnessRunId: HarnessRunIdSchema.optional(),
    status: ObservedStatusSchema.optional(),
    rawEventType: nonEmptyStringSchema.optional(),
    providerData: optionalProviderDataSchema,
    observedAt: TimestampSchema,
  })
  .strict();

export type HarnessEventObservation = z.infer<typeof HarnessEventObservationSchema>;

export const TerminalIdentityBindingSchema = z
  .object({
    provider: ProviderIdSchema,
    targetId: TerminalTargetIdSchema,
    projectId: ProjectIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    harnessRunId: HarnessRunIdSchema.optional(),
    providerData: optionalProviderDataSchema,
    confidence: ConfidenceSchema,
    reason: nonEmptyStringSchema,
  })
  .strict();

export type TerminalIdentityBinding = z.infer<typeof TerminalIdentityBindingSchema>;

export const CommandSourceSchema = z
  .object({
    kind: z.enum(["branch", "pr", "manual"]),
    value: nonEmptyStringSchema,
  })
  .strict();

export const CreateWorktreePayloadSchema = z
  .object({
    projectId: ProjectIdSchema,
    branch: nonEmptyStringSchema,
    base: nonEmptyStringSchema.optional(),
    path: nonEmptyStringSchema.optional(),
    source: CommandSourceSchema.optional(),
  })
  .strict();

export type CreateWorktreePayload = z.infer<typeof CreateWorktreePayloadSchema>;

export const RemoveWorktreePayloadSchema = z
  .object({
    worktreeId: WorktreeIdSchema,
    projectId: ProjectIdSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict();

export type RemoveWorktreePayload = z.infer<typeof RemoveWorktreePayloadSchema>;

export const HarnessCommandOptionsSchema = z
  .object({
    provider: ProviderIdSchema,
    mode: z.enum(["interactive", "exec"]).optional(),
    profile: nonEmptyStringSchema.optional(),
    approvalPolicy: nonEmptyStringSchema.optional(),
    sandboxMode: nonEmptyStringSchema.optional(),
  })
  .strict();

export const TerminalCommandOptionsSchema = z
  .object({
    provider: ProviderIdSchema,
    layout: z.enum(["default", "agent-only", "agent-build-shell"]).optional(),
    focus: z.boolean().optional(),
  })
  .strict();

export const CreateSessionPayloadSchema = z
  .object({
    projectId: ProjectIdSchema,
    branch: nonEmptyStringSchema,
    base: nonEmptyStringSchema.optional(),
    source: CommandSourceSchema.optional(),
    harness: HarnessCommandOptionsSchema,
    terminal: TerminalCommandOptionsSchema,
    initialPrompt: nonEmptyStringSchema.optional(),
  })
  .strict();

export type CreateSessionPayload = z.infer<typeof CreateSessionPayloadSchema>;

export const StartAgentPayloadSchema = z
  .object({
    projectId: ProjectIdSchema,
    worktreeId: WorktreeIdSchema,
    harness: HarnessCommandOptionsSchema.omit({ approvalPolicy: true, sandboxMode: true }),
    terminal: TerminalCommandOptionsSchema.partial().optional(),
    initialPrompt: nonEmptyStringSchema.optional(),
  })
  .strict();

export type StartAgentPayload = z.infer<typeof StartAgentPayloadSchema>;

export const WosmCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("worktree.create"), payload: CreateWorktreePayloadSchema }).strict(),
  z.object({ type: z.literal("worktree.remove"), payload: RemoveWorktreePayloadSchema }).strict(),
  z.object({ type: z.literal("session.create"), payload: CreateSessionPayloadSchema }).strict(),
  z.object({ type: z.literal("session.startAgent"), payload: StartAgentPayloadSchema }).strict(),
  z
    .object({
      type: z.literal("terminal.focus"),
      payload: z
        .object({
          targetId: TerminalTargetIdSchema.optional(),
          sessionId: SessionIdSchema.optional(),
          worktreeId: WorktreeIdSchema.optional(),
        })
        .strict()
        .refine(
          (payload) => payload.targetId ?? payload.sessionId ?? payload.worktreeId,
          "terminal.focus requires targetId, sessionId, or worktreeId",
        ),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.close"),
      payload: z
        .object({
          sessionId: SessionIdSchema,
          mode: z.enum(["harness", "terminal", "all"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.remove"),
      payload: z
        .object({
          sessionId: SessionIdSchema,
          removeWorktree: z.boolean(),
          force: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.sendPrompt"),
      payload: z
        .object({
          sessionId: SessionIdSchema,
          prompt: nonEmptyStringSchema,
          delivery: z.enum(["harness-native", "paste-and-focus"]).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("observer.reconcile"),
      payload: z
        .object({
          reason: nonEmptyStringSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("hooks.install"),
      payload: z
        .object({
          provider: ProviderIdSchema,
        })
        .strict(),
    })
    .strict(),
]);

export type WosmCommand = z.infer<typeof WosmCommandSchema>;

export const CommandReceiptSchema = z
  .object({
    commandId: CommandIdSchema,
    accepted: z.boolean(),
    status: z.enum(["accepted", "rejected"]),
    error: SafeErrorSchema.optional(),
  })
  .strict();

export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;

export const WosmEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("observer.started"), at: TimestampSchema }).strict(),
  z
    .object({
      type: z.literal("observer.reconciled"),
      at: TimestampSchema,
      changed: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ type: z.literal("project.updated"), projectId: ProjectIdSchema }).strict(),
  z.object({ type: z.literal("worktree.added"), row: WorktreeRowSchema }).strict(),
  z
    .object({
      type: z.literal("worktree.updated"),
      worktreeId: WorktreeIdSchema,
      patch: WorktreeRowSchema.partial(),
    })
    .strict(),
  z.object({ type: z.literal("worktree.removed"), worktreeId: WorktreeIdSchema }).strict(),
  z
    .object({
      type: z.literal("worktree.agentStateChanged"),
      worktreeId: WorktreeIdSchema,
      agent: WorktreeAgentSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("session.created"), session: SessionViewSchema }).strict(),
  z
    .object({
      type: z.literal("session.updated"),
      sessionId: SessionIdSchema,
      patch: SessionViewSchema.partial(),
    })
    .strict(),
  z.object({ type: z.literal("session.removed"), sessionId: SessionIdSchema }).strict(),
  z
    .object({
      type: z.literal("command.accepted"),
      commandId: CommandIdSchema,
      command: WosmCommandSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("command.started"),
      commandId: CommandIdSchema,
      command: WosmCommandSchema,
    })
    .strict(),
  z.object({ type: z.literal("command.succeeded"), commandId: CommandIdSchema }).strict(),
  z
    .object({
      type: z.literal("command.failed"),
      commandId: CommandIdSchema,
      error: SafeErrorSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.healthChanged"),
      provider: ProviderIdSchema,
      health: ProviderHealthSchema,
    })
    .strict(),
]);

export type WosmEvent = z.infer<typeof WosmEventSchema>;
