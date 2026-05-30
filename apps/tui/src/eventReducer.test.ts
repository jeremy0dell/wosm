import type { WosmEvent } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { createCommandSnapshot, fixtureNow, row } from "../test/fixtures/snapshots.js";
import { applyWosmEvent } from "./eventReducer.js";

describe("TUI event reducer", () => {
  it("applies direct worktree row updates without requesting a snapshot refresh", () => {
    const snapshot = createCommandSnapshot("idle");
    const event: WosmEvent = {
      type: "worktree.updated",
      worktreeId: "wt_web_idle",
      patch: {
        display: {
          statusLabel: "working",
          sortPriority: 30,
          alert: false,
          reason: "Harness reported active generation.",
        },
      },
    };

    const result = applyWosmEvent(snapshot, event);
    expect(result.needsSnapshotRefresh).toBe(false);
    expect(result.snapshot.rows[0]?.display.statusLabel).toBe("working");
  });

  it("adds and removes worktree rows from normalized events", () => {
    const snapshot = createCommandSnapshot("none");
    const added = applyWosmEvent(snapshot, {
      type: "worktree.added",
      row: row({ id: "wt_web_added", projectId: "web", branch: "new-row", state: "none" }),
    });

    expect(added.snapshot.rows.map((candidate) => candidate.id)).toContain("wt_web_added");

    const removed = applyWosmEvent(added.snapshot, {
      type: "worktree.removed",
      worktreeId: "wt_web_added",
    });
    expect(removed.snapshot.rows.map((candidate) => candidate.id)).not.toContain("wt_web_added");
  });

  it("updates row display from live agent state events", () => {
    const snapshot = createCommandSnapshot("idle");
    const result = applyWosmEvent(snapshot, {
      type: "worktree.agentStateChanged",
      worktreeId: "wt_web_idle",
      agent: {
        harness: "codex",
        state: "needs_attention",
        runId: "run_wt_web_idle",
        sessionId: "ses_wt_web_idle",
        confidence: "high",
        reason: "Codex requested permission.",
        updatedAt: fixtureNow,
      },
    });

    expect(result.needsSnapshotRefresh).toBe(false);
    expect(result.snapshot.rows[0]?.agent?.state).toBe("needs_attention");
    expect(result.snapshot.rows[0]?.display).toMatchObject({
      statusLabel: "needs attention",
      alert: true,
      reason: "Codex requested permission.",
    });
  });

  it("turns command failures into safe diagnostic toasts", () => {
    const snapshot = createCommandSnapshot("idle");
    const result = applyWosmEvent(snapshot, {
      type: "command.failed",
      commandId: "cmd_focus_1",
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TARGET_MISSING",
        message: "The terminal target for this worktree no longer exists.",
        hint: "Refresh the dashboard or reopen the worktree.",
        diagnosticId: "diag_terminal_missing",
        traceId: "trc_terminal_missing",
      },
    });

    expect(result.toasts).toEqual([
      expect.objectContaining({
        kind: "error",
        message: "The terminal target for this worktree no longer exists.",
        diagnosticId: "diag_terminal_missing",
        traceId: "trc_terminal_missing",
      }),
    ]);
  });

  it("requests snapshot refresh after reconcile and provider health events", () => {
    const snapshot = createCommandSnapshot("idle");
    const reconciled = applyWosmEvent(snapshot, {
      type: "observer.reconciled",
      at: fixtureNow,
      changed: 1,
    });
    const provider = applyWosmEvent(snapshot, {
      type: "provider.healthChanged",
      provider: "tmux",
      health: {
        providerId: "tmux",
        providerType: "terminal",
        status: "healthy",
        lastCheckedAt: fixtureNow,
      },
    });

    expect(reconciled.needsSnapshotRefresh).toBe(true);
    expect(provider.needsSnapshotRefresh).toBe(true);
  });
});
