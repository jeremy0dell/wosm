import type { ProviderHookEvent } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import {
  type HookPayloadSummary,
  harnessEventReportFromHookEvent,
  shouldReportHarnessEvent,
} from "../../src/providerReports";

const now = "2026-05-20T12:00:00.000Z";

describe("hook bridge provider report mapping", () => {
  it("keeps Codex as the only report-producing harness mapper for this phase", () => {
    expect(shouldReportHarnessEvent(hookEvent("codex", "PreToolUse", codexPayload()))).toBe(true);
    expect(shouldReportHarnessEvent(hookEvent("opencode", "permission.asked", {}))).toBe(false);
    expect(shouldReportHarnessEvent(hookEvent("fake-harness", "run.updated", {}))).toBe(false);
  });

  it("maps Codex hooks into provider-neutral reports at the hook boundary", () => {
    const result = harnessEventReportFromHookEvent(
      hookEvent("codex", "PermissionRequest", codexPermissionPayload()),
      payloadSummary(),
      () => "report_fallback",
    );

    expect(result).toMatchObject({
      ok: true,
      report: {
        reportId: "hook_1",
        provider: "codex",
        kind: "harness",
        eventType: "PermissionRequest",
        status: {
          value: "needs_attention",
          confidence: "high",
          source: "harness_hook",
        },
        correlation: {
          projectId: "web",
          worktreeId: "wt_web_task",
          sessionId: "ses_web_task",
          terminalTargetId: "tmux:wosm:@1:%2",
        },
        diagnostics: {
          rawEventType: "PermissionRequest",
          payloadBytes: 1024,
          compactedBytes: 256,
          compacted: true,
          omittedFieldNames: ["tool_input"],
        },
      },
    });
  });

  it("returns a typed result instead of throwing for invalid Codex payloads", () => {
    const result = harnessEventReportFromHookEvent(
      hookEvent("codex", "UnknownFutureEvent", {
        ...codexPayload(),
        hook_event_name: "UnknownFutureEvent",
      }),
      payloadSummary(),
      () => "report_fallback",
    );

    expect(result.ok).toBe(false);
  });
});

function hookEvent(provider: string, event: string, payload: unknown): ProviderHookEvent {
  return {
    schemaVersion: "0.3.0",
    hookId: "hook_1",
    provider,
    kind: "harness",
    event,
    receivedAt: now,
    payload,
  };
}

function codexPayload() {
  return {
    session_id: "codex_session_1",
    transcript_path: null,
    cwd: "/tmp/wosm/web/task",
    hook_event_name: "PreToolUse",
    model: "gpt-5.4-codex",
    permission_mode: "default",
    turn_id: "turn_1",
    tool_name: "Bash",
    tool_input: {
      compacted: true,
      originalBytes: 1024,
    },
    tool_use_id: "call_test",
    wosm_project_id: "web",
    wosm_worktree_id: "wt_web_task",
    wosm_session_id: "ses_web_task",
    wosm_terminal_target_id: "tmux:wosm:@1:%2",
  };
}

function codexPermissionPayload() {
  return {
    session_id: "codex_session_1",
    transcript_path: null,
    cwd: "/tmp/wosm/web/task",
    hook_event_name: "PermissionRequest",
    model: "gpt-5.4-codex",
    permission_mode: "default",
    turn_id: "turn_1",
    tool_name: "Bash",
    tool_input: {
      compacted: true,
      originalBytes: 1024,
    },
    wosm_project_id: "web",
    wosm_worktree_id: "wt_web_task",
    wosm_session_id: "ses_web_task",
    wosm_terminal_target_id: "tmux:wosm:@1:%2",
  };
}

function payloadSummary(): HookPayloadSummary {
  return {
    present: true,
    originalBytes: 1024,
    compactedBytes: 256,
    compacted: true,
    omittedFieldNames: ["tool_input"],
  };
}
