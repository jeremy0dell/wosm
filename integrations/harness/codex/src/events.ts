import type {
  HarnessEventContext,
  HarnessEventObservation,
  ObservedStatus,
  RawHarnessEvent,
  TerminalTargetObservation,
  WorktreeObservation,
} from "@wosm/contracts";
import { z } from "zod";
import { codexHarnessError } from "./errors.js";

const nonEmptyStringSchema = z.string().min(1);
const nullableStringSchema = z.string().nullable();
const permissionModeSchema = z
  .enum(["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"])
  .optional();

const commonFields = {
  session_id: nonEmptyStringSchema,
  transcript_path: nullableStringSchema,
  cwd: nonEmptyStringSchema,
  model: nonEmptyStringSchema,
  permission_mode: permissionModeSchema,
};

const optionalSubagentFields = {
  agent_id: nonEmptyStringSchema.optional(),
  agent_type: nonEmptyStringSchema.optional(),
};

const turnFields = {
  ...commonFields,
  turn_id: nonEmptyStringSchema,
  ...optionalSubagentFields,
};

const SessionStartEventSchema = z
  .object({
    ...commonFields,
    hook_event_name: z.literal("SessionStart"),
    source: z.enum(["startup", "resume", "clear", "compact"]),
  })
  .strict();

const UserPromptSubmitEventSchema = z
  .object({
    ...turnFields,
    hook_event_name: z.literal("UserPromptSubmit"),
    prompt: nonEmptyStringSchema,
  })
  .strict();

const PreToolUseEventSchema = z
  .object({
    ...turnFields,
    hook_event_name: z.literal("PreToolUse"),
    tool_name: nonEmptyStringSchema,
    tool_input: z.unknown(),
    tool_use_id: nonEmptyStringSchema,
  })
  .strict();

const PermissionRequestEventSchema = z
  .object({
    ...turnFields,
    hook_event_name: z.literal("PermissionRequest"),
    tool_name: nonEmptyStringSchema,
    tool_input: z.unknown(),
  })
  .strict();

const PostToolUseEventSchema = z
  .object({
    ...turnFields,
    hook_event_name: z.literal("PostToolUse"),
    tool_name: nonEmptyStringSchema,
    tool_use_id: nonEmptyStringSchema,
    tool_input: z.unknown(),
    tool_response: z.unknown(),
  })
  .strict();

const PreCompactEventSchema = z
  .object({
    ...turnFields,
    hook_event_name: z.literal("PreCompact"),
    trigger: z.enum(["manual", "auto"]),
  })
  .strict();

const PostCompactEventSchema = z
  .object({
    ...turnFields,
    hook_event_name: z.literal("PostCompact"),
    trigger: z.enum(["manual", "auto"]),
  })
  .strict();

const SubagentStartEventSchema = z
  .object({
    ...commonFields,
    hook_event_name: z.literal("SubagentStart"),
    turn_id: nonEmptyStringSchema,
    agent_id: nonEmptyStringSchema,
    agent_type: nonEmptyStringSchema,
  })
  .strict();

const SubagentStopEventSchema = z
  .object({
    ...commonFields,
    hook_event_name: z.literal("SubagentStop"),
    turn_id: nonEmptyStringSchema,
    agent_transcript_path: nullableStringSchema,
    agent_id: nonEmptyStringSchema,
    agent_type: nonEmptyStringSchema,
    stop_hook_active: z.boolean(),
    last_assistant_message: nullableStringSchema,
  })
  .strict();

const StopEventSchema = z
  .object({
    ...commonFields,
    hook_event_name: z.literal("Stop"),
    turn_id: nonEmptyStringSchema,
    stop_hook_active: z.boolean(),
    last_assistant_message: nullableStringSchema,
  })
  .strict();

export const CodexHookEventSchema = z.discriminatedUnion("hook_event_name", [
  SessionStartEventSchema,
  UserPromptSubmitEventSchema,
  PreToolUseEventSchema,
  PermissionRequestEventSchema,
  PostToolUseEventSchema,
  PreCompactEventSchema,
  PostCompactEventSchema,
  SubagentStartEventSchema,
  SubagentStopEventSchema,
  StopEventSchema,
]);

export type CodexHookEvent = z.infer<typeof CodexHookEventSchema>;

export function parseCodexHookEvent(input: unknown): CodexHookEvent {
  const result = CodexHookEventSchema.safeParse(input);
  if (!result.success) {
    throw codexHarnessError(
      "HARNESS_CODEX_EVENT_INVALID",
      "Codex hook event did not match a supported strict schema.",
      result.error,
    );
  }
  return result.data;
}

export function normalizeCodexRawEvent(
  raw: RawHarnessEvent,
  context: HarnessEventContext,
): HarnessEventObservation[] {
  const event = parseCodexHookEvent(raw.event);
  const observedAt = raw.observedAt ?? new Date().toISOString();
  const correlation = correlateCodexEvent(event, context);
  const observation: HarnessEventObservation = {
    provider: "codex",
    rawEventType: event.hook_event_name,
    status: statusFromCodexHookEvent(event, observedAt),
    observedAt,
    providerData: providerDataFromCodexEvent(event),
  };
  if (correlation.sessionId !== undefined) {
    observation.sessionId = correlation.sessionId;
  }
  if (correlation.worktreeId !== undefined) {
    observation.worktreeId = correlation.worktreeId;
  }
  if (correlation.harnessRunId !== undefined) {
    observation.harnessRunId = correlation.harnessRunId;
  }
  return [observation];
}

export function statusFromCodexHookEvent(
  event: CodexHookEvent,
  observedAt: string,
): ObservedStatus {
  if (event.hook_event_name === "SessionStart") {
    return {
      value: "starting",
      confidence: "high",
      reason: `Codex session started from ${event.source}.`,
      source: "harness_hook",
      updatedAt: observedAt,
    };
  }
  if (event.hook_event_name === "PermissionRequest") {
    return {
      value: "needs_attention",
      confidence: "high",
      reason: `Codex requested permission for ${event.tool_name}.`,
      source: "harness_hook",
      updatedAt: observedAt,
    };
  }
  if (event.hook_event_name === "Stop") {
    return {
      value: "unknown",
      confidence: "low",
      reason: "Codex stop hook fired, but no reliable idle signal was observed.",
      source: "harness_hook",
      updatedAt: observedAt,
    };
  }
  if (event.hook_event_name === "SubagentStop") {
    return {
      value: "working",
      confidence: "medium",
      reason: `Codex subagent ${event.agent_type} stopped.`,
      source: "harness_hook",
      updatedAt: observedAt,
    };
  }
  if (event.hook_event_name === "PostToolUse") {
    return {
      value: "working",
      confidence: "medium",
      reason: `Codex completed ${event.tool_name}.`,
      source: "harness_hook",
      updatedAt: observedAt,
    };
  }
  if (event.hook_event_name === "PreCompact") {
    return {
      value: "working",
      confidence: "medium",
      reason: `Codex is about to compact the conversation (${event.trigger}).`,
      source: "harness_hook",
      updatedAt: observedAt,
    };
  }
  if (event.hook_event_name === "PostCompact") {
    return {
      value: "working",
      confidence: "medium",
      reason: `Codex compacted the conversation (${event.trigger}).`,
      source: "harness_hook",
      updatedAt: observedAt,
    };
  }
  if (event.hook_event_name === "SubagentStart") {
    return {
      value: "working",
      confidence: "medium",
      reason: `Codex started subagent ${event.agent_type}.`,
      source: "harness_hook",
      updatedAt: observedAt,
    };
  }
  if (event.hook_event_name === "PreToolUse") {
    return {
      value: "working",
      confidence: "medium",
      reason: `Codex is about to use ${event.tool_name}.`,
      source: "harness_hook",
      updatedAt: observedAt,
    };
  }
  return {
    value: "working",
    confidence: "medium",
    reason: "Codex received a user prompt.",
    source: "harness_hook",
    updatedAt: observedAt,
  };
}

function providerDataFromCodexEvent(event: CodexHookEvent): Record<string, unknown> {
  const providerData: Record<string, unknown> = {
    codexSessionId: event.session_id,
    hookEventName: event.hook_event_name,
    cwd: event.cwd,
    model: event.model,
  };
  if (event.permission_mode !== undefined) {
    providerData.permissionMode = event.permission_mode;
  }
  if ("turn_id" in event) {
    providerData.codexTurnId = event.turn_id;
  }
  if ("source" in event) {
    providerData.source = event.source;
  }
  if ("tool_name" in event) {
    providerData.toolName = event.tool_name;
  }
  if ("tool_use_id" in event) {
    providerData.toolUseId = event.tool_use_id;
  }
  if ("agent_id" in event && event.agent_id !== undefined) {
    providerData.agentId = event.agent_id;
  }
  if ("agent_type" in event && event.agent_type !== undefined) {
    providerData.agentType = event.agent_type;
  }
  if ("agent_transcript_path" in event) {
    providerData.agentTranscriptPath = event.agent_transcript_path;
  }
  if ("trigger" in event) {
    providerData.trigger = event.trigger;
  }
  return providerData;
}

function correlateCodexEvent(
  event: CodexHookEvent,
  context: HarnessEventContext,
): {
  sessionId?: string;
  worktreeId?: string;
  harnessRunId?: string;
} {
  const terminal = terminalForCwd(event.cwd, context.terminalTargets);
  const worktree = worktreeForCwd(event.cwd, context.worktrees);
  const result: {
    sessionId?: string;
    worktreeId?: string;
    harnessRunId?: string;
  } = {};
  if (terminal?.sessionId !== undefined) {
    result.sessionId = terminal.sessionId;
  }
  if (terminal?.worktreeId !== undefined) {
    result.worktreeId = terminal.worktreeId;
  } else if (worktree !== undefined) {
    result.worktreeId = worktree.id;
  }
  if (terminal?.harnessRunId !== undefined) {
    result.harnessRunId = terminal.harnessRunId;
  } else if (terminal !== undefined) {
    result.harnessRunId = `codex:${terminal.id}`;
  }
  return result;
}

function terminalForCwd(
  cwd: string,
  targets: TerminalTargetObservation[],
): TerminalTargetObservation | undefined {
  return targets.find((target) => target.cwd === cwd);
}

function worktreeForCwd(
  cwd: string,
  worktrees: WorktreeObservation[],
): WorktreeObservation | undefined {
  return worktrees.find((worktree) => worktree.path === cwd);
}
