import type { RawHarnessEvent } from "@wosm/contracts";
import { HarnessEventObservationSchema } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { CodexHarnessProviderError } from "../../src/errors";
import { normalizeCodexRawEvent, parseCodexHookEvent } from "../../src/events";

const now = "2026-05-21T12:00:00.000Z";

describe("Codex hook event parsing", () => {
  it("strictly parses documented SessionStart events and normalizes them", () => {
    const raw: RawHarnessEvent = {
      provider: "codex",
      observedAt: now,
      event: {
        session_id: "codex_session_123",
        transcript_path: null,
        cwd: "/tmp/wosm/web/task",
        hook_event_name: "SessionStart",
        model: "gpt-5.4-codex",
        permission_mode: "default",
        source: "startup",
      },
    };

    expect(parseCodexHookEvent(raw.event)).toMatchObject({
      hook_event_name: "SessionStart",
      source: "startup",
    });

    const observations = normalizeCodexRawEvent(raw, context());

    expect(observations).toHaveLength(1);
    expect(HarnessEventObservationSchema.parse(observations[0])).toEqual(observations[0]);
    expect(observations[0]).toMatchObject({
      provider: "codex",
      sessionId: "ses_web_task",
      worktreeId: "wt_web_task",
      rawEventType: "SessionStart",
      status: {
        value: "starting",
        confidence: "high",
        source: "harness_hook",
      },
      providerData: {
        codexSessionId: "codex_session_123",
        hookEventName: "SessionStart",
      },
    });
  });

  it("maps PermissionRequest to needs_attention without leaking tool input", () => {
    const observations = normalizeCodexRawEvent(
      {
        provider: "codex",
        observedAt: now,
        event: {
          session_id: "codex_session_123",
          transcript_path: null,
          cwd: "/tmp/wosm/web/task",
          hook_event_name: "PermissionRequest",
          model: "gpt-5.4-codex",
          permission_mode: "default",
          turn_id: "turn_1",
          tool_name: "Bash",
          tool_input: {
            command: "rm -rf /tmp/example",
            description: "Delete temp files",
          },
        },
      },
      context(),
    );

    expect(observations[0]).toMatchObject({
      rawEventType: "PermissionRequest",
      status: {
        value: "needs_attention",
        confidence: "high",
        reason: "Codex requested permission for Bash.",
      },
    });
    expect(JSON.stringify(observations[0]?.providerData)).not.toContain("rm -rf");
  });

  it("accepts current Codex lifecycle hook input shapes", () => {
    const common = {
      session_id: "codex_session_123",
      transcript_path: null,
      cwd: "/tmp/wosm/web/task",
      model: "gpt-5.5",
      permission_mode: "default",
    };
    const turn = {
      ...common,
      turn_id: "turn_1",
    };

    const payloads = [
      {
        ...common,
        hook_event_name: "SessionStart",
        source: "compact",
      },
      {
        ...turn,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "pnpm test:all" },
        tool_use_id: "call_test",
      },
      {
        ...turn,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "pwd" },
        tool_response: "/tmp/wosm/web/task\n",
        tool_use_id: "call_test",
      },
      {
        ...turn,
        hook_event_name: "PreCompact",
        trigger: "manual",
        agent_id: "agent_1",
        agent_type: "reviewer",
      },
      {
        ...turn,
        hook_event_name: "PostCompact",
        trigger: "auto",
      },
      {
        ...turn,
        hook_event_name: "SubagentStart",
        agent_id: "agent_1",
        agent_type: "reviewer",
      },
      {
        ...turn,
        hook_event_name: "SubagentStop",
        agent_transcript_path: null,
        agent_id: "agent_1",
        agent_type: "reviewer",
        stop_hook_active: false,
        last_assistant_message: "Reviewed.",
      },
    ];

    expect(payloads.map((payload) => parseCodexHookEvent(payload).hook_event_name)).toEqual([
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "PreCompact",
      "PostCompact",
      "SubagentStart",
      "SubagentStop",
    ]);
  });

  it("keeps Stop as unknown low confidence instead of inventing idle", () => {
    const observations = normalizeCodexRawEvent(
      {
        provider: "codex",
        observedAt: now,
        event: {
          session_id: "codex_session_123",
          transcript_path: null,
          cwd: "/tmp/wosm/web/task",
          hook_event_name: "Stop",
          model: "gpt-5.4-codex",
          permission_mode: "default",
          turn_id: "turn_1",
          stop_hook_active: false,
          last_assistant_message: "Done.",
        },
      },
      context(),
    );

    expect(observations[0]).toMatchObject({
      rawEventType: "Stop",
      status: {
        value: "unknown",
        confidence: "low",
      },
    });
  });

  it("throws typed provider errors for unsupported or mismatched payloads", () => {
    expect(() =>
      parseCodexHookEvent({
        session_id: "codex_session_123",
        transcript_path: null,
        cwd: "/tmp/wosm/web/task",
        hook_event_name: "SessionStart",
        model: "gpt-5.4-codex",
        source: "startup",
        unexpected: true,
      }),
    ).toThrowError(CodexHarnessProviderError);

    expect(() =>
      parseCodexHookEvent({
        session_id: "codex_session_123",
        transcript_path: null,
        cwd: "/tmp/wosm/web/task",
        hook_event_name: "UnknownFutureEvent",
        model: "gpt-5.4-codex",
      }),
    ).toThrowError(CodexHarnessProviderError);
  });
});

function context() {
  return {
    projects: [],
    worktrees: [
      {
        id: "wt_web_task",
        provider: "worktrunk",
        projectId: "web",
        branch: "task",
        path: "/tmp/wosm/web/task",
        state: "exists" as const,
        source: "worktrunk" as const,
        observedAt: now,
      },
    ],
    terminalTargets: [
      {
        id: "tmux:wosm:@1:%2",
        provider: "tmux",
        projectId: "web",
        worktreeId: "wt_web_task",
        sessionId: "ses_web_task",
        state: "open" as const,
        cwd: "/tmp/wosm/web/task",
        confidence: "high" as const,
        reason: "tmux pane has wosm identity binding.",
        observedAt: now,
        providerData: {
          harness: "codex",
          role: "main-agent",
        },
      },
    ],
  };
}
