import type { PiSupportedEventName } from "./eventNames.js";
import { commonPiCompactFieldNames, normalizePiEventType } from "./eventSchema.js";

export type PiPayloadCompactionResult = {
  payload: unknown;
  compacted: boolean;
  originalByteCount: number | null;
  compactedByteCount: number | null;
  omittedFieldNames: string[];
};

export function compactPiHookPayload(
  eventType: string,
  payload: unknown,
): PiPayloadCompactionResult {
  const originalByteCount = jsonByteCount(payload);
  if (!isRecord(payload)) {
    return {
      payload,
      compacted: false,
      originalByteCount,
      compactedByteCount: originalByteCount,
      omittedFieldNames: [],
    };
  }

  const output: Record<string, unknown> = {};
  const copiedFields = new Set<string>();
  const omittedFieldNames = new Set<string>();
  const normalizedEventType = normalizePiEventType(
    typeof payload.event_type === "string" ? payload.event_type : eventType,
  );
  output.event_type = normalizedEventType;
  copiedFields.add("event_type");

  for (const fieldName of fieldNamesForEvent(normalizedEventType)) {
    if (fieldName === "event_type" || !hasOwn(payload, fieldName)) {
      continue;
    }
    output[fieldName] = payload[fieldName];
    copiedFields.add(fieldName);
  }

  for (const fieldName of Object.keys(payload)) {
    if (!copiedFields.has(fieldName)) {
      omittedFieldNames.add(fieldName);
    }
  }

  const compacted = omittedFieldNames.size > 0;
  return {
    payload: output,
    compacted,
    originalByteCount,
    compactedByteCount: jsonByteCount(output),
    omittedFieldNames: [...omittedFieldNames].sort(),
  };
}

function fieldNamesForEvent(eventType: PiSupportedEventName): string[] {
  const fields: string[] = [...commonPiCompactFieldNames];
  if (eventType === "session_start") {
    fields.push("reason", "previous_session_file");
    return fields;
  }
  if (eventType === "session_shutdown") {
    fields.push("reason", "target_session_file");
    return fields;
  }
  if (eventType === "agent_end") {
    fields.push("message_count");
    return fields;
  }
  if (eventType === "turn_start") {
    fields.push("turn_index");
    return fields;
  }
  if (eventType === "tool_execution_start") {
    fields.push("tool_call_id", "tool_name");
    return fields;
  }
  if (eventType === "tool_execution_end") {
    fields.push("tool_call_id", "tool_name", "is_error");
    return fields;
  }
  if (eventType === "message_end") {
    fields.push("message_role");
    return fields;
  }
  if (eventType === "session_compact") {
    fields.push("from_extension", "compaction_entry_id");
    return fields;
  }
  return fields;
}

function jsonByteCount(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return null;
    }
    return Buffer.byteLength(serialized, "utf8");
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}
