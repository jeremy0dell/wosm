import { z } from "zod";
import { SafeErrorSchema } from "./errors";
import {
  CommandIdSchema,
  ProjectIdSchema,
  ProviderIdSchema,
  SessionIdSchema,
  TerminalTargetIdSchema,
  WorktreeIdSchema,
} from "./ids";
import { nonEmptyStringSchema } from "./shared";

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
