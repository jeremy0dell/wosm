import { z } from "zod";
import { SafeErrorSchema } from "./errors";
import type {
  HarnessRunId,
  ProjectId,
  ProviderId,
  SessionId,
  TerminalTargetId,
  WorktreeId,
} from "./ids";
import { ProviderIdSchema, TimestampSchema } from "./ids";
import type {
  HarnessEventObservation,
  HarnessRunObservation,
  HarnessStatusObservation,
  TerminalIdentityBinding,
  TerminalTargetObservation,
  WorktreeObservation,
} from "./observations";
import { nonEmptyStringSchema } from "./shared";

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
