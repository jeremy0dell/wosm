import { z } from "zod";
import { WosmCommandSchema } from "./commands";
import { SafeErrorSchema } from "./errors";
import {
  CommandIdSchema,
  ProjectIdSchema,
  ProviderIdSchema,
  SessionIdSchema,
  TimestampSchema,
  WorktreeIdSchema,
} from "./ids";
import { ProviderHealthSchema } from "./providers";
import { SessionViewSchema, WorktreeAgentSchema, WorktreeRowSchema } from "./snapshot";

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
