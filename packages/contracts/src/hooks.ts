import { z } from "zod";
import { SafeErrorSchema } from "./errors.js";
import {
  ProjectIdSchema,
  ProviderIdSchema,
  SchemaVersionSchema,
  SessionIdSchema,
  TimestampSchema,
  WorktreeIdSchema,
} from "./ids.js";
import { nonEmptyStringSchema, optionalProviderDataSchema } from "./shared.js";

export const ProviderHookKindSchema = z.enum(["worktree", "terminal", "harness", "provider"]);

export const ProviderHookEventSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    hookId: nonEmptyStringSchema.optional(),
    provider: ProviderIdSchema,
    kind: ProviderHookKindSchema,
    event: nonEmptyStringSchema,
    receivedAt: TimestampSchema,
    projectId: ProjectIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    payload: optionalProviderDataSchema,
  })
  .strict();

export type ProviderHookEvent = z.infer<typeof ProviderHookEventSchema>;

export const HookReceiptSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    hookId: nonEmptyStringSchema,
    provider: ProviderIdSchema,
    event: nonEmptyStringSchema,
    accepted: z.boolean(),
    status: z.enum(["ingested", "spooled", "rejected"]),
    receivedAt: TimestampSchema,
    reconciled: z.boolean().optional(),
    spooled: z.boolean().optional(),
    deduped: z.boolean().optional(),
    error: SafeErrorSchema.optional(),
  })
  .strict();

export type HookReceipt = z.infer<typeof HookReceiptSchema>;

export const HookSpoolRecordSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    spoolId: nonEmptyStringSchema,
    createdAt: TimestampSchema,
    event: ProviderHookEventSchema,
    attempts: z.number().int().nonnegative(),
    lastError: SafeErrorSchema.optional(),
  })
  .strict();

export type HookSpoolRecord = z.infer<typeof HookSpoolRecordSchema>;
