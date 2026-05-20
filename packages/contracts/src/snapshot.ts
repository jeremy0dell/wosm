import { z } from "zod";
import {
  HarnessRunIdSchema,
  ProjectIdSchema,
  ProviderIdSchema,
  SchemaVersionSchema,
  SessionIdSchema,
  TerminalTargetIdSchema,
  TimestampSchema,
  WorktreeIdSchema,
} from "./ids";
import {
  AgentStateSchema,
  ConfidenceSchema,
  ObservedStatusSchema,
  TerminalStateSchema,
  WorktreePullRequestSchema,
  WorktreeSourceSchema,
  WorktreeStateSchema,
} from "./observations";
import { HarnessCapabilitiesSchema, ProviderHealthSchema } from "./providers";
import { nonEmptyStringSchema, optionalProviderDataSchema, safeTextSchema } from "./shared";

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
