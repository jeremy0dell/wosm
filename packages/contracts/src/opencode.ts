import { z } from "zod";
import type { HarnessIngressRule } from "./harnessIngress.js";
import { nonEmptyStringSchema } from "./shared.js";

export const OpenCodeEventTypeSchema = nonEmptyStringSchema
  .transform((value) => value.trim())
  .pipe(nonEmptyStringSchema);

const OpenCodeNativeStatusSchema = z.union([
  nonEmptyStringSchema,
  z
    .object({
      type: nonEmptyStringSchema,
    })
    .passthrough(),
]);

const OpenCodeNativeToolRefSchema = z
  .object({
    messageID: nonEmptyStringSchema.optional(),
    callID: nonEmptyStringSchema.optional(),
  })
  .passthrough();

const OpenCodeNativeInfoSchema = z
  .object({
    id: nonEmptyStringSchema.optional(),
  })
  .passthrough();

const OpenCodeNativeErrorSchema = z
  .object({
    name: nonEmptyStringSchema.optional(),
  })
  .passthrough();

export const OpenCodeNativeEventPropertiesSchema = z
  .object({
    sessionID: nonEmptyStringSchema.optional(),
    sessionId: nonEmptyStringSchema.optional(),
    cwd: nonEmptyStringSchema.optional(),
    directory: nonEmptyStringSchema.optional(),
    status: OpenCodeNativeStatusSchema.optional(),
    reply: nonEmptyStringSchema.optional(),
    answers: z.array(z.unknown()).optional(),
    requestID: nonEmptyStringSchema.optional(),
    id: nonEmptyStringSchema.optional(),
    messageID: nonEmptyStringSchema.optional(),
    partID: nonEmptyStringSchema.optional(),
    callID: nonEmptyStringSchema.optional(),
    tool: z.union([nonEmptyStringSchema, OpenCodeNativeToolRefSchema]).optional(),
    name: nonEmptyStringSchema.optional(),
    permission: nonEmptyStringSchema.optional(),
    command: nonEmptyStringSchema.optional(),
    file: nonEmptyStringSchema.optional(),
    path: nonEmptyStringSchema.optional(),
    error: OpenCodeNativeErrorSchema.optional(),
    info: OpenCodeNativeInfoSchema.optional(),
  })
  .catchall(z.unknown());

export type OpenCodeNativeEventProperties = z.infer<typeof OpenCodeNativeEventPropertiesSchema>;

export const OpenCodeNativeEventSchema = z
  .object({
    id: nonEmptyStringSchema.optional(),
    type: OpenCodeEventTypeSchema,
    cwd: nonEmptyStringSchema.optional(),
    directory: nonEmptyStringSchema.optional(),
    pid: z.number().int().positive().optional(),
    properties: OpenCodeNativeEventPropertiesSchema.optional(),
  })
  .passthrough();

export type OpenCodeNativeEvent = z.infer<typeof OpenCodeNativeEventSchema>;

const workingMedium = { statusIntents: ["working"], confidences: ["medium"] } as const;

export const openCodeIngressRules = [
  { provider: "opencode", eventType: "command.executed", ...workingMedium },
  {
    provider: "opencode",
    eventType: "permission.asked",
    statusIntents: ["needs_attention"],
    confidences: ["high"],
  },
  {
    provider: "opencode",
    eventType: "permission.replied",
    statusIntents: ["idle", "working"],
    confidences: ["medium", "high"],
  },
  {
    provider: "opencode",
    eventType: "question.asked",
    statusIntents: ["needs_attention"],
    confidences: ["high"],
  },
  {
    provider: "opencode",
    eventType: "question.rejected",
    statusIntents: ["idle"],
    confidences: ["medium"],
  },
  {
    provider: "opencode",
    eventType: "question.replied",
    statusIntents: ["working"],
    confidences: ["high"],
  },
  { provider: "opencode", eventType: "session.compacted", ...workingMedium },
  {
    provider: "opencode",
    eventType: "session.created",
    statusIntents: ["starting"],
    confidences: ["medium"],
  },
  {
    provider: "opencode",
    eventType: "session.deleted",
    statusIntents: ["exited"],
    confidences: ["high"],
  },
  {
    provider: "opencode",
    eventType: "session.error",
    statusIntents: ["needs_attention"],
    confidences: ["high"],
  },
  {
    provider: "opencode",
    eventType: "session.idle",
    statusIntents: ["idle"],
    confidences: ["high"],
  },
  { provider: "opencode", eventType: "session.next.compaction.delta", ...workingMedium },
  { provider: "opencode", eventType: "session.next.compaction.ended", ...workingMedium },
  { provider: "opencode", eventType: "session.next.compaction.started", ...workingMedium },
  { provider: "opencode", eventType: "session.next.prompted", ...workingMedium },
  { provider: "opencode", eventType: "session.next.shell.ended", ...workingMedium },
  { provider: "opencode", eventType: "session.next.shell.started", ...workingMedium },
  { provider: "opencode", eventType: "session.next.step.ended", ...workingMedium },
  { provider: "opencode", eventType: "session.next.step.failed", ...workingMedium },
  { provider: "opencode", eventType: "session.next.step.started", ...workingMedium },
  { provider: "opencode", eventType: "session.next.synthetic", ...workingMedium },
  { provider: "opencode", eventType: "session.next.tool.called", ...workingMedium },
  { provider: "opencode", eventType: "session.next.tool.failed", ...workingMedium },
  { provider: "opencode", eventType: "session.next.tool.input.delta", ...workingMedium },
  { provider: "opencode", eventType: "session.next.tool.input.ended", ...workingMedium },
  { provider: "opencode", eventType: "session.next.tool.input.started", ...workingMedium },
  { provider: "opencode", eventType: "session.next.tool.progress", ...workingMedium },
  { provider: "opencode", eventType: "session.next.tool.success", ...workingMedium },
  {
    provider: "opencode",
    eventType: "session.status",
    statusIntents: ["idle", "working"],
    confidences: ["medium", "high"],
  },
  { provider: "opencode", eventType: "tool.execute.after", ...workingMedium },
  { provider: "opencode", eventType: "tool.execute.before", ...workingMedium },
  {
    provider: "opencode",
    eventType: "tui.command.execute",
    statusIntents: ["idle"],
    confidences: ["medium"],
  },
] as const satisfies readonly HarnessIngressRule<"opencode", string>[];

export type OpenCodeIngressRule = (typeof openCodeIngressRules)[number];

export const openCodeForwardedEventTypes = openCodeIngressRules.map((rule) => rule.eventType);

export type OpenCodeForwardedEventType = (typeof openCodeForwardedEventTypes)[number];

const openCodeIngressRuleByEventType: ReadonlyMap<string, OpenCodeIngressRule> = new Map(
  openCodeIngressRules.map((rule) => [rule.eventType, rule]),
);

export function openCodeIngressRuleForEventType(value: string): OpenCodeIngressRule | undefined {
  return openCodeIngressRuleByEventType.get(value);
}

export function isOpenCodeForwardedEventType(value: string): value is OpenCodeForwardedEventType {
  return openCodeIngressRuleByEventType.has(value);
}

export const OpenCodeCompactEventSchema = z
  .object({
    event_type: OpenCodeEventTypeSchema,
    observed_at: nonEmptyStringSchema.optional(),
    event_id: nonEmptyStringSchema.optional(),
    cwd: nonEmptyStringSchema,
    pid: z.number().int().positive().optional(),
    opencode_session_id: nonEmptyStringSchema.optional(),
    status_type: nonEmptyStringSchema.optional(),
    permission_reply: nonEmptyStringSchema.optional(),
    question_reply: nonEmptyStringSchema.optional(),
    request_id: nonEmptyStringSchema.optional(),
    message_id: nonEmptyStringSchema.optional(),
    part_id: nonEmptyStringSchema.optional(),
    tool_call_id: nonEmptyStringSchema.optional(),
    tool_name: nonEmptyStringSchema.optional(),
    command_name: nonEmptyStringSchema.optional(),
    file_path: nonEmptyStringSchema.optional(),
    error_name: nonEmptyStringSchema.optional(),
    property_keys: z.array(nonEmptyStringSchema).max(128).optional(),
    wosm_project_id: nonEmptyStringSchema.optional(),
    wosm_worktree_id: nonEmptyStringSchema.optional(),
    wosm_worktree_path: nonEmptyStringSchema.optional(),
    wosm_session_id: nonEmptyStringSchema.optional(),
    wosm_terminal_provider: nonEmptyStringSchema.optional(),
    wosm_terminal_target_id: nonEmptyStringSchema.optional(),
    wosm_integration_id: nonEmptyStringSchema.optional(),
    wosm_integration_version: nonEmptyStringSchema.optional(),
  })
  .strict();

export type OpenCodeCompactEvent = z.infer<typeof OpenCodeCompactEventSchema>;

export const openCodeCompactFieldNames = [
  "event_type",
  "observed_at",
  "event_id",
  "cwd",
  "pid",
  "opencode_session_id",
  "status_type",
  "permission_reply",
  "question_reply",
  "request_id",
  "message_id",
  "part_id",
  "tool_call_id",
  "tool_name",
  "command_name",
  "file_path",
  "error_name",
  "property_keys",
  "wosm_project_id",
  "wosm_worktree_id",
  "wosm_worktree_path",
  "wosm_session_id",
  "wosm_terminal_provider",
  "wosm_terminal_target_id",
  "wosm_integration_id",
  "wosm_integration_version",
] as const;
