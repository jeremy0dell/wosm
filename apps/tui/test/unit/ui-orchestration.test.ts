import { describe, expect, it } from "vitest";
import {
  addPendingCreate,
  applyEventToUiOrchestration,
  applySnapshotToUiOrchestration,
  attachPendingCreateCommand,
  createInitialUiOrchestrationState,
} from "../../src/orchestration/uiOrchestration.js";
import { createCommandSnapshot, row } from "../fixtures/snapshots.js";

describe("TUI optimistic orchestration", () => {
  it("tracks pending creates without materializing optional command ids", () => {
    const state = addPendingCreate(createInitialUiOrchestrationState(), {
      id: "pending_1",
      projectId: "web",
      branch: "feature/new",
      harnessProvider: "codex",
    });

    expect(state.pendingCreates).toEqual([
      {
        id: "pending_1",
        projectId: "web",
        branch: "feature/new",
        harnessProvider: "codex",
      },
    ]);
    expect(Object.hasOwn(state.pendingCreates[0] ?? {}, "commandId")).toBe(false);
  });

  it("attaches command ids and removes matching command failures", () => {
    const pending = addPendingCreate(createInitialUiOrchestrationState(), {
      id: "pending_1",
      projectId: "web",
      branch: "feature/new",
      harnessProvider: "codex",
    });
    const tracked = attachPendingCreateCommand(pending, "pending_1", "cmd_1");

    expect(tracked.pendingCreates[0]?.commandId).toBe("cmd_1");
    expect(
      applyEventToUiOrchestration(tracked, {
        type: "command.failed",
        commandId: "cmd_1",
        error: {
          tag: "CommandExecutionError",
          code: "CREATE_FAILED",
          message: "Create failed.",
        },
      }).pendingCreates,
    ).toEqual([]);
  });

  it("removes pending creates when provider truth contains the same project and branch", () => {
    const pending = addPendingCreate(createInitialUiOrchestrationState(), {
      id: "pending_1",
      projectId: "web",
      branch: "feature-start",
      harnessProvider: "codex",
    });
    const snapshot = createCommandSnapshot("none");

    expect(applySnapshotToUiOrchestration(pending, snapshot).pendingCreates).toEqual([]);
  });

  it("removes pending creates from matching worktree events only", () => {
    const pending = addPendingCreate(createInitialUiOrchestrationState(), {
      id: "pending_1",
      projectId: "web",
      branch: "feature/new",
      harnessProvider: "codex",
    });

    const unrelated = applyEventToUiOrchestration(pending, {
      type: "worktree.added",
      row: row({
        id: "wt_api_feature",
        projectId: "api",
        branch: "feature/new",
        state: "none",
      }),
    });
    expect(unrelated.pendingCreates).toHaveLength(1);

    const matched = applyEventToUiOrchestration(unrelated, {
      type: "worktree.added",
      row: row({
        id: "wt_web_feature",
        projectId: "web",
        branch: "feature/new",
        state: "none",
      }),
    });
    expect(matched.pendingCreates).toEqual([]);
  });
});
