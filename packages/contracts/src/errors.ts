import { z } from "zod";
import {
  CommandIdSchema,
  ProjectIdSchema,
  ProviderIdSchema,
  SessionIdSchema,
  TimestampSchema,
  WorktreeIdSchema,
} from "./ids.js";
import { nonEmptyStringSchema, safeTextSchema } from "./shared.js";

export const ErrorSeveritySchema = z.enum(["debug", "info", "warn", "error", "fatal"]);

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
