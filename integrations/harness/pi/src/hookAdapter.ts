import type {
  HarnessEventReportResult,
  HookScopeDecision,
  ProviderHookAdapter,
  ProviderHookEvent,
  ProviderHookPayloadCompactionResult,
  ProviderHookPayloadEnrichmentInput,
  ProviderHookReportInput,
} from "@wosm/contracts";
import { ProviderHookEventSchema } from "@wosm/contracts";
import {
  compactPiHookPayload,
  normalizePiEventType,
  piHookPayloadToHarnessEventReport,
} from "./events.js";

export const piHookAdapter: ProviderHookAdapter = {
  provider: "pi",
  kind: "harness",
  normalizeEventName: normalizePiEventName,
  enrichPayload: enrichPiHookPayload,
  decideScope: decidePiHookScope,
  compactPayload: compactPiHookEventPayload,
  toHarnessEventReport: piHookEventReport,
};

function normalizePiEventName(event: string): string {
  return normalizePiEventType(event);
}

function enrichPiHookPayload(input: ProviderHookPayloadEnrichmentInput): unknown {
  if (!isRecord(input.payload)) {
    return input.payload;
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.payload)) {
    next[key] = value;
  }
  assignEnvField(next, "wosm_project_id", input.env.WOSM_PROJECT_ID);
  assignEnvField(next, "wosm_worktree_id", input.env.WOSM_WORKTREE_ID);
  assignEnvField(next, "wosm_worktree_path", input.env.WOSM_WORKTREE_PATH);
  assignEnvField(next, "wosm_session_id", input.env.WOSM_SESSION_ID);
  assignEnvField(next, "wosm_terminal_provider", input.env.WOSM_TERMINAL_PROVIDER);
  assignEnvField(next, "wosm_terminal_target_id", input.env.WOSM_TERMINAL_TARGET_ID);
  return next;
}

function decidePiHookScope(event: ProviderHookEvent): HookScopeDecision {
  if (event.kind !== "harness") {
    return { action: "accept", reason: "not-required" };
  }
  if (!isRecord(event.payload)) {
    return { action: "ignore", reason: "missing-wosm-env" };
  }

  const sessionId = stringField(event.payload, "wosm_session_id");
  const worktreeId = stringField(event.payload, "wosm_worktree_id");
  if (sessionId !== undefined && worktreeId !== undefined) {
    return { action: "accept", reason: "wosm-env" };
  }
  return { action: "ignore", reason: "missing-wosm-env" };
}

function compactPiHookEventPayload(event: ProviderHookEvent): ProviderHookPayloadCompactionResult {
  const compaction = compactPiHookPayload(event.event, event.payload);
  const compactedEvent = ProviderHookEventSchema.parse({
    ...event,
    payload: compaction.payload,
  });
  return {
    event: compactedEvent,
    payloadSummary: {
      present: true,
      originalBytes: compaction.originalByteCount,
      compactedBytes: compaction.compactedByteCount,
      compacted: compaction.compacted,
      omittedFieldNames: compaction.omittedFieldNames,
    },
  };
}

function piHookEventReport(input: ProviderHookReportInput): HarnessEventReportResult {
  try {
    return {
      ok: true,
      report: piHookPayloadToHarnessEventReport({
        reportId: input.event.hookId ?? input.fallbackReportId(),
        eventType: input.event.event,
        observedAt: input.event.receivedAt,
        payload: input.event.payload,
        diagnostics: {
          payloadBytes: input.payloadSummary.originalBytes,
          compactedBytes: input.payloadSummary.compactedBytes,
          compacted: input.payloadSummary.compacted,
          truncated: false,
          omittedFieldNames: input.payloadSummary.omittedFieldNames,
        },
      }),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

function assignEnvField(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  if (target[key] !== undefined || value === undefined || value.length === 0) {
    return;
  }
  target[key] = value;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
