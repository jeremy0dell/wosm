import { z } from "zod";
import { SafeErrorSchema } from "./errors.js";
import { WosmEventSchema, WosmEventTypeSchema } from "./events.js";
import {
  HarnessRunIdSchema,
  ProjectIdSchema,
  type ProviderId,
  ProviderIdSchema,
  SchemaVersionSchema,
  SessionIdSchema,
  TerminalTargetIdSchema,
  TimestampSchema,
  WorktreeIdSchema,
} from "./ids.js";
import { HarnessEventDiagnosticsSchema, ObservedStatusSchema } from "./observations.js";
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
export type ProviderHookKind = z.infer<typeof ProviderHookKindSchema>;

export const HookReceiptSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    hookId: nonEmptyStringSchema,
    provider: ProviderIdSchema,
    event: nonEmptyStringSchema,
    accepted: z.boolean(),
    status: z.enum(["ingested", "spooled", "rejected", "ignored"]),
    receivedAt: TimestampSchema,
    reconciled: z.boolean().optional(),
    spooled: z.boolean().optional(),
    deduped: z.boolean().optional(),
    error: SafeErrorSchema.optional(),
  })
  .strict();

export type HookReceipt = z.infer<typeof HookReceiptSchema>;

export const HarnessEventReportCorrelationSchema = z
  .object({
    harnessRunId: HarnessRunIdSchema.optional(),
    sessionId: SessionIdSchema.optional(),
    worktreeId: WorktreeIdSchema.optional(),
    terminalTargetId: TerminalTargetIdSchema.optional(),
    projectId: ProjectIdSchema.optional(),
    nativeSessionId: nonEmptyStringSchema.optional(),
    cwd: nonEmptyStringSchema.optional(),
    pid: z.number().int().positive().optional(),
  })
  .strict();

export type HarnessEventReportCorrelation = z.infer<typeof HarnessEventReportCorrelationSchema>;

export const HarnessEventReportDiagnosticsSchema = HarnessEventDiagnosticsSchema;

export type HarnessEventReportDiagnostics = z.infer<typeof HarnessEventReportDiagnosticsSchema>;

export const HarnessEventReportSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    reportId: nonEmptyStringSchema,
    provider: ProviderIdSchema,
    kind: z.literal("harness"),
    eventType: nonEmptyStringSchema,
    observedAt: TimestampSchema,
    coalesceKey: nonEmptyStringSchema.optional(),
    status: ObservedStatusSchema.optional(),
    correlation: HarnessEventReportCorrelationSchema.optional(),
    diagnostics: HarnessEventReportDiagnosticsSchema.optional(),
    providerData: optionalProviderDataSchema,
  })
  .strict();

export type HarnessEventReport = z.infer<typeof HarnessEventReportSchema>;

export const HarnessEventReportReceiptSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    reportId: nonEmptyStringSchema,
    provider: ProviderIdSchema,
    eventType: nonEmptyStringSchema,
    accepted: z.boolean(),
    status: z.enum(["accepted", "spooled", "rejected"]),
    receivedAt: TimestampSchema,
    projected: z.boolean().optional(),
    scheduledReconcile: z.boolean().optional(),
    deduped: z.boolean().optional(),
    error: SafeErrorSchema.optional(),
  })
  .strict();

export type HarnessEventReportReceipt = z.infer<typeof HarnessEventReportReceiptSchema>;

export const HookPayloadSummarySchema = z
  .object({
    present: z.boolean(),
    originalBytes: z.number().int().nonnegative().nullable(),
    compactedBytes: z.number().int().nonnegative().nullable(),
    compacted: z.boolean(),
    omittedFieldNames: z.array(nonEmptyStringSchema),
  })
  .strict();

export type HookPayloadSummary = z.infer<typeof HookPayloadSummarySchema>;

export const WosmHookIdentityPayloadSchema = z
  .object({
    wosm_project_id: nonEmptyStringSchema.optional(),
    wosm_worktree_id: nonEmptyStringSchema.optional(),
    wosm_worktree_path: nonEmptyStringSchema.optional(),
    wosm_session_id: nonEmptyStringSchema.optional(),
    wosm_terminal_provider: nonEmptyStringSchema.optional(),
    wosm_terminal_target_id: nonEmptyStringSchema.optional(),
  })
  .passthrough();

export type WosmHookIdentityPayload = z.infer<typeof WosmHookIdentityPayloadSchema>;

export function parseWosmHookIdentityPayload(
  payload: unknown,
): WosmHookIdentityPayload | undefined {
  const result = WosmHookIdentityPayloadSchema.safeParse(payload);
  return result.success ? result.data : undefined;
}

export type HookScopeDecision =
  | {
      action: "accept";
      reason: "not-required" | "wosm-env";
    }
  | {
      action: "ignore";
      reason: "missing-wosm-env";
    };

export type ProviderHookPayloadEnrichmentInput = {
  payload: unknown;
  env: Record<string, string | undefined>;
};

export type ProviderHookPayloadCompactionResult = {
  event: ProviderHookEvent;
  payloadSummary: HookPayloadSummary;
};

export type HarnessEventReportResult =
  | {
      ok: true;
      report: HarnessEventReport;
    }
  | {
      ok: false;
      error: unknown;
    };

export type ProviderHookReportInput = {
  event: ProviderHookEvent;
  payloadSummary: HookPayloadSummary;
  fallbackReportId: () => string;
};

export type ProviderHookAdapter = {
  provider: ProviderId;
  kind?: ProviderHookKind;
  normalizeEventName?: (event: string) => string;
  enrichPayload?: (input: ProviderHookPayloadEnrichmentInput) => unknown;
  decideScope?: (event: ProviderHookEvent) => HookScopeDecision;
  compactPayload?: (event: ProviderHookEvent) => ProviderHookPayloadCompactionResult;
  toHarnessEventReport?: (input: ProviderHookReportInput) => HarnessEventReportResult;
};

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

export const HarnessEventReportSpoolRecordSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    spoolId: nonEmptyStringSchema,
    createdAt: TimestampSchema,
    report: HarnessEventReportSchema,
    attempts: z.number().int().nonnegative(),
    lastError: SafeErrorSchema.optional(),
  })
  .strict();

export type HarnessEventReportSpoolRecord = z.infer<typeof HarnessEventReportSpoolRecordSchema>;

export const EventHookFilterSchema = z
  .object({
    agentState: ObservedStatusSchema.shape.value.optional(),
    harness: ProviderIdSchema.optional(),
  })
  .strict();

export type EventHookFilter = z.infer<typeof EventHookFilterSchema>;

export const EventHookConfigSchema = z
  .object({
    id: nonEmptyStringSchema,
    events: z.array(WosmEventTypeSchema).min(1),
    command: nonEmptyStringSchema,
    args: z.array(nonEmptyStringSchema).optional(),
    timeoutMs: z.number().int().positive().optional(),
    filter: EventHookFilterSchema.optional(),
  })
  .strict();

export type EventHookConfig = z.infer<typeof EventHookConfigSchema>;

export const EventHookInvocationSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    hookId: nonEmptyStringSchema,
    observedAt: TimestampSchema,
    event: WosmEventSchema,
  })
  .strict();

export type EventHookInvocation = z.infer<typeof EventHookInvocationSchema>;
