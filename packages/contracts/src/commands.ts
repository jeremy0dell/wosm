import { z } from "zod";
import { SafeErrorSchema } from "./errors.js";
import {
  CommandIdSchema,
  ProjectIdSchema,
  ProviderIdSchema,
  SessionIdSchema,
  TerminalTargetIdSchema,
  TimestampSchema,
  WorktreeIdSchema,
} from "./ids.js";
import { nonEmptyStringSchema } from "./shared.js";

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

export const StartAgentHarnessCommandOptionsSchema = z
  .object({
    provider: ProviderIdSchema.optional(),
    mode: z.enum(["interactive", "exec"]).optional(),
    profile: nonEmptyStringSchema.optional(),
  })
  .strict();

export const TerminalFocusOriginSchema = z
  .object({
    provider: ProviderIdSchema,
    clientId: nonEmptyStringSchema.optional(),
  })
  .strict();

export type TerminalFocusOrigin = z.infer<typeof TerminalFocusOriginSchema>;

export const TerminalCommandOptionsSchema = z
  .object({
    provider: ProviderIdSchema,
    layout: z.enum(["default", "agent-only", "agent-build-shell"]).optional(),
    focus: z.boolean().optional(),
    origin: TerminalFocusOriginSchema.optional(),
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
    harness: StartAgentHarnessCommandOptionsSchema.optional(),
    terminal: TerminalCommandOptionsSchema.partial().optional(),
    initialPrompt: nonEmptyStringSchema.optional(),
  })
  .strict();

export type StartAgentPayload = z.infer<typeof StartAgentPayloadSchema>;

export const TerminalFocusPayloadSchema = z
  .object({
    targetId: TerminalTargetIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    origin: TerminalFocusOriginSchema.optional(),
  })
  .strict()
  .refine(
    (payload) => payload.targetId ?? payload.sessionId ?? payload.worktreeId,
    "terminal.focus requires targetId, sessionId, or worktreeId",
  );

export type TerminalFocusPayload = z.infer<typeof TerminalFocusPayloadSchema>;

export const TerminalClosePayloadSchema = z
  .object({
    targetId: TerminalTargetIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine(
    (payload) => payload.targetId ?? payload.sessionId ?? payload.worktreeId,
    "terminal.close requires targetId, sessionId, or worktreeId",
  );

export type TerminalClosePayload = z.infer<typeof TerminalClosePayloadSchema>;

export const CloseSessionPayloadSchema = z
  .object({
    sessionId: SessionIdSchema,
    mode: z.enum(["harness", "terminal", "all"]),
    force: z.boolean().optional(),
  })
  .strict();

export type CloseSessionPayload = z.infer<typeof CloseSessionPayloadSchema>;

export const RemoveSessionPayloadSchema = z
  .object({
    sessionId: SessionIdSchema,
    removeWorktree: z.boolean(),
    force: z.boolean().optional(),
  })
  .strict();

export type RemoveSessionPayload = z.infer<typeof RemoveSessionPayloadSchema>;

export const SendPromptPayloadSchema = z
  .object({
    sessionId: SessionIdSchema,
    prompt: nonEmptyStringSchema,
    delivery: z.enum(["harness-native", "paste-and-focus"]).optional(),
  })
  .strict();

export type SendPromptPayload = z.infer<typeof SendPromptPayloadSchema>;

export const RenameSessionPayloadSchema = z
  .object({
    sessionId: SessionIdSchema,
    title: nonEmptyStringSchema,
  })
  .strict();

export type RenameSessionPayload = z.infer<typeof RenameSessionPayloadSchema>;

export const ObserverReconcilePayloadSchema = z
  .object({
    reason: nonEmptyStringSchema.optional(),
  })
  .strict();

export type ObserverReconcilePayload = z.infer<typeof ObserverReconcilePayloadSchema>;

export const InstallHooksPayloadSchema = z
  .object({
    provider: ProviderIdSchema,
  })
  .strict();

export type InstallHooksPayload = z.infer<typeof InstallHooksPayloadSchema>;

export const WosmCommandTypeSchema = z.enum([
  "worktree.create",
  "worktree.remove",
  "session.create",
  "session.startAgent",
  "terminal.focus",
  "terminal.close",
  "session.close",
  "session.remove",
  "session.sendPrompt",
  "session.rename",
  "observer.reconcile",
  "hooks.install",
]);

export const CreateWorktreeCommandSchema = z
  .object({ type: z.literal("worktree.create"), payload: CreateWorktreePayloadSchema })
  .strict();

export const RemoveWorktreeCommandSchema = z
  .object({ type: z.literal("worktree.remove"), payload: RemoveWorktreePayloadSchema })
  .strict();

export const CreateSessionCommandSchema = z
  .object({ type: z.literal("session.create"), payload: CreateSessionPayloadSchema })
  .strict();

export const StartAgentCommandSchema = z
  .object({ type: z.literal("session.startAgent"), payload: StartAgentPayloadSchema })
  .strict();

export const TerminalFocusCommandSchema = z
  .object({ type: z.literal("terminal.focus"), payload: TerminalFocusPayloadSchema })
  .strict();

export const TerminalCloseCommandSchema = z
  .object({ type: z.literal("terminal.close"), payload: TerminalClosePayloadSchema })
  .strict();

export const CloseSessionCommandSchema = z
  .object({ type: z.literal("session.close"), payload: CloseSessionPayloadSchema })
  .strict();

export const RemoveSessionCommandSchema = z
  .object({ type: z.literal("session.remove"), payload: RemoveSessionPayloadSchema })
  .strict();

export const SendPromptCommandSchema = z
  .object({ type: z.literal("session.sendPrompt"), payload: SendPromptPayloadSchema })
  .strict();

export const RenameSessionCommandSchema = z
  .object({ type: z.literal("session.rename"), payload: RenameSessionPayloadSchema })
  .strict();

export const ObserverReconcileCommandSchema = z
  .object({ type: z.literal("observer.reconcile"), payload: ObserverReconcilePayloadSchema })
  .strict();

export const InstallHooksCommandSchema = z
  .object({ type: z.literal("hooks.install"), payload: InstallHooksPayloadSchema })
  .strict();

export const WosmCommandSchema = z.discriminatedUnion("type", [
  CreateWorktreeCommandSchema,
  RemoveWorktreeCommandSchema,
  CreateSessionCommandSchema,
  StartAgentCommandSchema,
  TerminalFocusCommandSchema,
  TerminalCloseCommandSchema,
  CloseSessionCommandSchema,
  RemoveSessionCommandSchema,
  SendPromptCommandSchema,
  RenameSessionCommandSchema,
  ObserverReconcileCommandSchema,
  InstallHooksCommandSchema,
]);

export type WosmCommand = z.infer<typeof WosmCommandSchema>;

export const CommandReceiptSchema = z
  .object({
    commandId: CommandIdSchema,
    traceId: nonEmptyStringSchema.optional(),
    spanId: nonEmptyStringSchema.optional(),
    accepted: z.boolean(),
    status: z.enum(["accepted", "rejected"]),
    error: SafeErrorSchema.optional(),
  })
  .strict();

export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;

export const CommandRecordSchema = z
  .object({
    id: CommandIdSchema,
    type: WosmCommandTypeSchema,
    command: WosmCommandSchema,
    status: z.enum(["accepted", "started", "succeeded", "failed"]),
    createdAt: TimestampSchema,
    startedAt: TimestampSchema.optional(),
    finishedAt: TimestampSchema.optional(),
    traceId: nonEmptyStringSchema.optional(),
    spanId: nonEmptyStringSchema.optional(),
    error: SafeErrorSchema.optional(),
  })
  .strict();

export type CommandRecord = z.infer<typeof CommandRecordSchema>;
