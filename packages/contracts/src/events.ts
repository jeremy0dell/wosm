import { z } from "zod";
import { WosmCommandSchema } from "./commands.js";
import { SafeErrorSchema } from "./errors.js";
import {
  CommandIdSchema,
  ProjectIdSchema,
  ProviderIdSchema,
  SessionIdSchema,
  TimestampSchema,
  WorktreeIdSchema,
} from "./ids.js";
import { ProviderHealthSchema } from "./providers.js";
import { nonEmptyStringSchema } from "./shared.js";
import { SessionViewSchema, WorktreeAgentSchema, WorktreeRowSchema } from "./snapshot.js";

export const WosmEventTypeSchema = z.enum([
  "observer.started",
  "observer.reconciled",
  "project.updated",
  "worktree.added",
  "worktree.updated",
  "worktree.removed",
  "worktree.agentStateChanged",
  "session.created",
  "session.updated",
  "session.removed",
  "command.accepted",
  "command.started",
  "command.succeeded",
  "command.failed",
  "provider.healthChanged",
  "hook.ingested",
  "hook.spoolDrained",
]);

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
  z
    .object({
      type: z.literal("hook.ingested"),
      at: TimestampSchema,
      hookId: nonEmptyStringSchema,
      provider: ProviderIdSchema,
      event: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("hook.spoolDrained"),
      at: TimestampSchema,
      drained: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    })
    .strict(),
]);

export type WosmEvent = z.infer<typeof WosmEventSchema>;

export const EventFilterSchema = z
  .object({
    type: z.union([WosmEventTypeSchema, z.array(WosmEventTypeSchema).min(1)]).optional(),
    commandId: CommandIdSchema.optional(),
    since: TimestampSchema.optional(),
  })
  .strict();

export type EventFilter = z.infer<typeof EventFilterSchema>;
