import {
  CommandIdSchema,
  CommandReceiptSchema,
  CommandRecordSchema,
  DiagnosticCollectionOptionsSchema,
  DiagnosticSnapshotSchema,
  DoctorOptionsSchema,
  DoctorReportSchema,
  EventFilterSchema,
  HarnessEventReportReceiptSchema,
  HarnessEventReportSchema,
  HookReceiptSchema,
  ObserverHealthSchema,
  ObserverStopReceiptSchema,
  ProviderHookEventSchema,
  ReconcileReceiptSchema,
  SafeErrorSchema,
  SchemaVersionSchema,
  WOSM_SCHEMA_VERSION,
  WosmCommandSchema,
  WosmEventSchema,
  WosmSnapshotSchema,
} from "@wosm/contracts";
import { z } from "zod";

export const PROTOCOL_SCHEMA_VERSION = WOSM_SCHEMA_VERSION;

export const ProtocolMethodSchema = z.enum([
  "observer.health",
  "observer.stop",
  "snapshot.get",
  "events.subscribe",
  "command.dispatch",
  "command.get",
  "observer.reconcile",
  "observer.ingestHookEvent",
  "observer.harnessEvent.report",
  "doctor.run",
  "diagnostics.collect",
]);

export type ProtocolMethod = z.infer<typeof ProtocolMethodSchema>;

export const JsonRpcVersionSchema = z.literal("2.0");

export const ProtocolRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    jsonrpc: JsonRpcVersionSchema,
    id: z.string().min(1),
    method: ProtocolMethodSchema,
    params: z.unknown().optional(),
  })
  .strict();

export type ProtocolRequest = z.infer<typeof ProtocolRequestSchema>;

export const ProtocolSuccessResponseSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    jsonrpc: JsonRpcVersionSchema,
    id: z.string().min(1),
    result: z.unknown(),
  })
  .strict();

export type ProtocolSuccessResponse = z.infer<typeof ProtocolSuccessResponseSchema>;

export const ProtocolErrorResponseSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    jsonrpc: JsonRpcVersionSchema,
    id: z.string().min(1),
    error: SafeErrorSchema,
  })
  .strict();

export type ProtocolErrorResponse = z.infer<typeof ProtocolErrorResponseSchema>;

export const ProtocolResponseSchema = z.union([
  ProtocolSuccessResponseSchema,
  ProtocolErrorResponseSchema,
]);

export type ProtocolResponse = z.infer<typeof ProtocolResponseSchema>;

export const ProtocolEventEnvelopeSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    event: WosmEventSchema,
  })
  .strict();

export type ProtocolEventEnvelope = z.infer<typeof ProtocolEventEnvelopeSchema>;

export const ProtocolMessageSchema = z.union([
  ProtocolRequestSchema,
  ProtocolResponseSchema,
  ProtocolEventEnvelopeSchema,
]);

export const SnapshotGetParamsSchema = z
  .object({
    includeDebug: z.boolean().optional(),
  })
  .strict()
  .optional();

export const CommandDispatchParamsSchema = z
  .object({
    command: WosmCommandSchema,
  })
  .strict();

export const CommandGetParamsSchema = z
  .object({
    commandId: CommandIdSchema,
  })
  .strict();

export const ReconcileParamsSchema = z
  .object({
    reason: z.string().min(1).optional(),
  })
  .strict()
  .optional();

export const HookIngestParamsSchema = z
  .object({
    event: ProviderHookEventSchema,
  })
  .strict();

export const HarnessEventReportParamsSchema = z
  .object({
    report: HarnessEventReportSchema,
  })
  .strict();

export const EventsSubscribeParamsSchema = EventFilterSchema.optional();

export const DoctorRunParamsSchema = DoctorOptionsSchema;

export const DiagnosticsCollectParamsSchema = DiagnosticCollectionOptionsSchema;

export const ProtocolResultSchemas = {
  "observer.health": ObserverHealthSchema,
  "observer.stop": ObserverStopReceiptSchema,
  "snapshot.get": WosmSnapshotSchema,
  "events.subscribe": z.object({ subscribed: z.literal(true) }).strict(),
  "command.dispatch": CommandReceiptSchema,
  "command.get": CommandRecordSchema.nullable(),
  "observer.reconcile": ReconcileReceiptSchema,
  "observer.ingestHookEvent": HookReceiptSchema,
  "observer.harnessEvent.report": HarnessEventReportReceiptSchema,
  "doctor.run": DoctorReportSchema,
  "diagnostics.collect": DiagnosticSnapshotSchema,
} as const;

export function protocolSafeError(input: {
  tag?: string;
  code?: string;
  message: string;
  hint?: string;
}) {
  return SafeErrorSchema.parse({
    tag: input.tag ?? "ProtocolError",
    code: input.code ?? "PROTOCOL_ERROR",
    message: input.message,
    ...(input.hint === undefined ? {} : { hint: input.hint }),
  });
}
