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

const DiagnosticEventFields = {
  traceId: nonEmptyStringSchema.optional(),
  spanId: nonEmptyStringSchema.optional(),
};

export const ObserverStartedEventSchema = z
  .object({ type: z.literal("observer.started"), at: TimestampSchema })
  .strict();

export const ObserverReconciledEventSchema = z
  .object({
    type: z.literal("observer.reconciled"),
    at: TimestampSchema,
    changed: z.number().int().nonnegative(),
    ...DiagnosticEventFields,
  })
  .strict();

export const ProjectUpdatedEventSchema = z
  .object({ type: z.literal("project.updated"), projectId: ProjectIdSchema })
  .strict();

export const WorktreeAddedEventSchema = z
  .object({ type: z.literal("worktree.added"), row: WorktreeRowSchema })
  .strict();

export const WorktreeUpdatedEventSchema = z
  .object({
    type: z.literal("worktree.updated"),
    worktreeId: WorktreeIdSchema,
    patch: WorktreeRowSchema.partial(),
  })
  .strict();

export const WorktreeRemovedEventSchema = z
  .object({ type: z.literal("worktree.removed"), worktreeId: WorktreeIdSchema })
  .strict();

export const WorktreeAgentStateChangedEventSchema = z
  .object({
    type: z.literal("worktree.agentStateChanged"),
    worktreeId: WorktreeIdSchema,
    agent: WorktreeAgentSchema.optional(),
  })
  .strict();

export const SessionCreatedEventSchema = z
  .object({ type: z.literal("session.created"), session: SessionViewSchema })
  .strict();

export const SessionUpdatedEventSchema = z
  .object({
    type: z.literal("session.updated"),
    sessionId: SessionIdSchema,
    patch: SessionViewSchema.partial(),
  })
  .strict();

export const SessionRemovedEventSchema = z
  .object({ type: z.literal("session.removed"), sessionId: SessionIdSchema })
  .strict();

export const CommandAcceptedEventSchema = z
  .object({
    type: z.literal("command.accepted"),
    commandId: CommandIdSchema,
    command: WosmCommandSchema,
    ...DiagnosticEventFields,
  })
  .strict();

export const CommandStartedEventSchema = z
  .object({
    type: z.literal("command.started"),
    commandId: CommandIdSchema,
    command: WosmCommandSchema,
    ...DiagnosticEventFields,
  })
  .strict();

export const CommandSucceededEventSchema = z
  .object({
    type: z.literal("command.succeeded"),
    commandId: CommandIdSchema,
    ...DiagnosticEventFields,
  })
  .strict();

export const CommandFailedEventSchema = z
  .object({
    type: z.literal("command.failed"),
    commandId: CommandIdSchema,
    error: SafeErrorSchema,
    ...DiagnosticEventFields,
  })
  .strict();

export const ProviderHealthChangedEventSchema = z
  .object({
    type: z.literal("provider.healthChanged"),
    provider: ProviderIdSchema,
    health: ProviderHealthSchema,
  })
  .strict();

export const HookIngestedEventSchema = z
  .object({
    type: z.literal("hook.ingested"),
    at: TimestampSchema,
    hookId: nonEmptyStringSchema,
    provider: ProviderIdSchema,
    event: nonEmptyStringSchema,
  })
  .strict();

export const HookSpoolDrainedEventSchema = z
  .object({
    type: z.literal("hook.spoolDrained"),
    at: TimestampSchema,
    drained: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .strict();

export const WosmEventSchema = z.discriminatedUnion("type", [
  ObserverStartedEventSchema,
  ObserverReconciledEventSchema,
  ProjectUpdatedEventSchema,
  WorktreeAddedEventSchema,
  WorktreeUpdatedEventSchema,
  WorktreeRemovedEventSchema,
  WorktreeAgentStateChangedEventSchema,
  SessionCreatedEventSchema,
  SessionUpdatedEventSchema,
  SessionRemovedEventSchema,
  CommandAcceptedEventSchema,
  CommandStartedEventSchema,
  CommandSucceededEventSchema,
  CommandFailedEventSchema,
  ProviderHealthChangedEventSchema,
  HookIngestedEventSchema,
  HookSpoolDrainedEventSchema,
]);

export type WosmEvent = z.infer<typeof WosmEventSchema>;

export const EventFilterSchema = z
  .object({
    type: z.union([WosmEventTypeSchema, z.array(WosmEventTypeSchema).min(1)]).optional(),
    commandId: CommandIdSchema.optional(),
    traceId: nonEmptyStringSchema.optional(),
    since: TimestampSchema.optional(),
  })
  .strict();

export type EventFilter = z.infer<typeof EventFilterSchema>;
