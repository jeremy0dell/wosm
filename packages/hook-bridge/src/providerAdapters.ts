import {
  codexHookPayloadToHarnessEventReport,
  compactCodexHookPayload,
  extractCodexHookScopeContext,
} from "@wosm/codex";
import type { HarnessEventReport, ProviderHookEvent } from "@wosm/contracts";
import { ProviderHookEventSchema } from "@wosm/contracts";
import { normalizeWorktrunkLifecycleEvent } from "@wosm/worktrunk";

export type HookPayloadSummary = {
  present: boolean;
  originalBytes: number | null;
  compactedBytes: number | null;
  compacted: boolean;
  omittedFieldNames: string[];
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

export type HookScopeDecision =
  | {
      action: "accept";
      reason: "not-required" | "wosm-env";
    }
  | {
      action: "ignore";
      reason: "missing-wosm-env";
    };

type HookScopeContext = {
  provider: string;
  kind: ProviderHookEvent["kind"];
  event: string;
  cwd?: string;
  wosmProjectId?: string;
  wosmWorktreeId?: string;
  wosmWorktreePath?: string;
  wosmSessionId?: string;
  wosmTerminalProvider?: string;
  wosmTerminalTargetId?: string;
};

export function normalizeProviderHookEventName(provider: string, event: string): string {
  return provider === "worktrunk" ? normalizeWorktrunkLifecycleEvent(event) : event;
}

export function enrichProviderHookPayload(input: {
  provider: string;
  payload: unknown;
  env: Record<string, string | undefined>;
}): unknown {
  if (input.provider !== "codex" || !isRecord(input.payload)) {
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

export function decideProviderHookScope(event: ProviderHookEvent): HookScopeDecision {
  if (!requiresOwnedScope(event)) {
    return { action: "accept", reason: "not-required" };
  }

  const context = normalizeHookScopeContext(event);
  if (context.wosmSessionId !== undefined && context.wosmWorktreeId !== undefined) {
    return { action: "accept", reason: "wosm-env" };
  }
  return { action: "ignore", reason: "missing-wosm-env" };
}

export function compactProviderHookEventPayload(event: ProviderHookEvent): {
  event: ProviderHookEvent;
  payloadSummary: HookPayloadSummary;
} {
  if (event.payload === undefined) {
    return {
      event,
      payloadSummary: {
        present: false,
        originalBytes: null,
        compactedBytes: null,
        compacted: false,
        omittedFieldNames: [],
      },
    };
  }

  if (event.provider !== "codex") {
    const byteCount = jsonByteCount(event.payload);
    return {
      event,
      payloadSummary: {
        present: true,
        originalBytes: byteCount,
        compactedBytes: byteCount,
        compacted: false,
        omittedFieldNames: [],
      },
    };
  }

  const compaction = compactCodexHookPayload(event.payload);
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

export function shouldReportHarnessEvent(event: ProviderHookEvent): boolean {
  return event.kind === "harness" && event.provider === "codex";
}

export function harnessEventReportFromHookEvent(
  event: ProviderHookEvent,
  payloadSummary: HookPayloadSummary,
  fallbackReportId: () => string,
): HarnessEventReportResult {
  if (event.provider !== "codex") {
    return {
      ok: false,
      error: new Error(`Unsupported harness event report provider: ${event.provider}`),
    };
  }

  try {
    return {
      ok: true,
      report: codexHookPayloadToHarnessEventReport({
        reportId: event.hookId ?? fallbackReportId(),
        observedAt: event.receivedAt,
        payload: event.payload,
        diagnostics: {
          payloadBytes: payloadSummary.originalBytes,
          compactedBytes: payloadSummary.compactedBytes,
          compacted: payloadSummary.compacted,
          truncated: false,
          omittedFieldNames: payloadSummary.omittedFieldNames,
        },
      }),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

function requiresOwnedScope(event: ProviderHookEvent): boolean {
  return event.kind === "harness" && event.provider === "codex";
}

function normalizeHookScopeContext(event: ProviderHookEvent): HookScopeContext {
  const context: HookScopeContext = {
    provider: event.provider,
    kind: event.kind,
    event: event.event,
  };
  if (event.provider !== "codex" || event.kind !== "harness") {
    return context;
  }

  const codexContext = extractCodexHookScopeContext(event.payload);
  assignScopeField(context, "cwd", codexContext.cwd);
  assignScopeField(context, "wosmProjectId", codexContext.wosmProjectId);
  assignScopeField(context, "wosmWorktreeId", codexContext.wosmWorktreeId);
  assignScopeField(context, "wosmWorktreePath", codexContext.wosmWorktreePath);
  assignScopeField(context, "wosmSessionId", codexContext.wosmSessionId);
  assignScopeField(context, "wosmTerminalProvider", codexContext.wosmTerminalProvider);
  assignScopeField(context, "wosmTerminalTargetId", codexContext.wosmTerminalTargetId);
  return context;
}

function assignScopeField(
  target: HookScopeContext,
  key: keyof Omit<HookScopeContext, "provider" | "kind" | "event">,
  value: string | undefined,
): void {
  if (value === undefined) {
    return;
  }
  target[key] = value;
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
