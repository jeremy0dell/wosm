import { z } from "zod";
import type { TerminalFocusOrigin } from "./commands.js";
import type { SafeError } from "./errors.js";
import { SafeErrorSchema } from "./errors.js";
import type {
  HarnessRunId,
  ProjectId,
  ProviderId,
  SessionId,
  TerminalTargetId,
  WorktreeId,
} from "./ids.js";
import { ProjectIdSchema, ProviderIdSchema, TimestampSchema } from "./ids.js";
import type {
  HarnessEventObservation,
  HarnessRunObservation,
  HarnessStatusObservation,
  TerminalIdentityBinding,
  TerminalTargetObservation,
  WorktreeObservation,
} from "./observations.js";
import { nonEmptyStringSchema } from "./shared.js";

export const ProviderTypeSchema = z.enum(["worktree", "terminal", "harness"]);
export const ProviderHealthStatusSchema = z.enum(["healthy", "degraded", "unavailable", "unknown"]);

export const ProviderHealthSchema = z
  .object({
    providerId: ProviderIdSchema,
    providerType: ProviderTypeSchema,
    status: ProviderHealthStatusSchema,
    lastCheckedAt: TimestampSchema,
    lastError: SafeErrorSchema.optional(),
    latencyMs: z.number().nonnegative().optional(),
    capabilities: z.record(nonEmptyStringSchema, z.boolean()).optional(),
    diagnostics: z.record(nonEmptyStringSchema, z.string()).optional(),
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

export const HarnessPermissionModeSchema = z.enum(["standard", "yolo"]);

export type HarnessPermissionMode = z.infer<typeof HarnessPermissionModeSchema>;

export const ProviderProjectDefaultsSchema = z
  .object({
    harness: ProviderIdSchema,
    terminal: ProviderIdSchema,
    layout: nonEmptyStringSchema,
  })
  .strict();

export const ProviderProjectWorktrunkConfigSchema = z
  .object({
    enabled: z.boolean(),
    base: nonEmptyStringSchema.optional(),
    managedRoot: nonEmptyStringSchema.optional(),
    includeMain: z.boolean().optional(),
    includeExternal: z.boolean().optional(),
  })
  .strict();

export const ProviderProjectRecoveryBreadcrumbsSchema = z
  .object({
    location: z.enum(["external", "worktree", "provider-native", "disabled"]),
    path: nonEmptyStringSchema.optional(),
  })
  .strict();

export const ProviderProjectConfigSchema = z
  .object({
    id: ProjectIdSchema,
    label: nonEmptyStringSchema,
    root: nonEmptyStringSchema,
    defaultBranch: nonEmptyStringSchema.optional(),
    defaults: ProviderProjectDefaultsSchema,
    worktrunk: ProviderProjectWorktrunkConfigSchema,
    recoveryBreadcrumbs: ProviderProjectRecoveryBreadcrumbsSchema.optional(),
  })
  .strict();

export type ProviderProjectConfig = z.infer<typeof ProviderProjectConfigSchema>;

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

export type RawWorktreeEvent = {
  provider: ProviderId;
  event: unknown;
  observedAt?: string;
};

export type WorktreeEventContext = {
  projects: ProviderProjectConfig[];
};

export type ProviderDoctorCheck = {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  error?: SafeError;
};

export type ProviderDoctorContext = {
  wosmConfigPath?: string;
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

export type RawTerminalEvent = {
  provider: ProviderId;
  event: unknown;
  observedAt?: string;
};

export type TerminalEventContext = {
  projects: ProviderProjectConfig[];
  worktrees: WorktreeObservation[];
};

export type TerminalCapture = {
  targetId: TerminalTargetId;
  capturedAt: string;
  text: string;
  providerData?: unknown;
};

export type TerminalFocusContext = {
  origin?: TerminalFocusOrigin;
};

export type BuildHarnessLaunchRequest = {
  project: ProviderProjectConfig;
  worktree: WorktreeObservation;
  terminalTarget?: TerminalTargetObservation;
  sessionId?: SessionId;
  mode?: "interactive" | "exec";
  initialPrompt?: string;
  profile?: string;
  permissionMode?: HarnessPermissionMode;
  approvalPolicy?: string;
  sandboxMode?: string;
};

export const HarnessLaunchPlanSchema = z
  .object({
    provider: ProviderIdSchema,
    command: nonEmptyStringSchema,
    args: z.array(z.string()),
    cwd: nonEmptyStringSchema.optional(),
    env: z.record(nonEmptyStringSchema, z.string()).optional(),
    mode: z.enum(["interactive", "exec"]),
    displayTitle: nonEmptyStringSchema.optional(),
    providerData: z.unknown().optional(),
  })
  .strict();

export type HarnessLaunchPlan = z.infer<typeof HarnessLaunchPlanSchema>;

export type TerminalLaunchProcessRequest = {
  project: ProviderProjectConfig;
  worktree: WorktreeObservation;
  terminalTarget: TerminalIdentityBinding;
  agentEndpointId: string;
  launchPlan: HarnessLaunchPlan;
  signal?: AbortSignal;
};

export type TerminalLaunchProcessResult = {
  terminalTargetId: TerminalTargetId;
  agentEndpointId: string;
  started: boolean;
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
  doctorChecks?(context?: ProviderDoctorContext): Promise<ProviderDoctorCheck[]>;
  ingestEvent?(
    event: RawWorktreeEvent,
    context: WorktreeEventContext,
  ): Promise<WorktreeObservation[]>;
  listWorktrees(project: ProviderProjectConfig): Promise<WorktreeObservation[]>;
  createWorktree(request: CreateWorktreeRequest): Promise<WorktreeObservation>;
  removeWorktree(request: RemoveWorktreeRequest): Promise<RemoveWorktreeResult>;
  getWorktree?(request: GetWorktreeRequest): Promise<WorktreeObservation | null>;
}

export interface TerminalProvider {
  id: ProviderId;
  capabilities(): TerminalCapabilities;
  health(): Promise<ProviderHealth>;
  doctorChecks?(context?: ProviderDoctorContext): Promise<ProviderDoctorCheck[]>;
  ingestEvent?(
    event: RawTerminalEvent,
    context: TerminalEventContext,
  ): Promise<TerminalTargetObservation[]>;
  listTargets(): Promise<TerminalTargetObservation[]>;
  openWorkspace(request: OpenWorkspaceRequest): Promise<OpenWorkspaceResult>;
  launchProcess?(request: TerminalLaunchProcessRequest): Promise<TerminalLaunchProcessResult>;
  focusTarget(targetId: TerminalTargetId, context?: TerminalFocusContext): Promise<void>;
  closeTarget(targetId: TerminalTargetId): Promise<void>;
  captureTarget?(targetId: TerminalTargetId): Promise<TerminalCapture>;
  sendInput?(targetId: TerminalTargetId, input: string): Promise<void>;
}

export interface HarnessProvider {
  id: ProviderId;
  capabilities(): HarnessCapabilities;
  health(): Promise<ProviderHealth>;
  doctorChecks?(context?: ProviderDoctorContext): Promise<ProviderDoctorCheck[]>;
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
