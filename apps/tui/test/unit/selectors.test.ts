import { describe, expect, it } from "vitest";
import { selectKeySlots, selectProjectGroups, selectVisibleRows } from "../../src/selectors.js";
import { createInitialUiState, setSearchQuery, toggleProjectCollapsed } from "../../src/uiState.js";
import { createDashboardSnapshot } from "../fixtures/snapshots.js";

describe("TUI selectors", () => {
  it("groups rows project-first and keeps zero-worktree projects visible", () => {
    const snapshot = createDashboardSnapshot();
    const groups = selectProjectGroups(snapshot, createInitialUiState());

    expect(groups.map((group) => [group.project.id, group.rows.length])).toEqual([
      ["web", 7],
      ["api", 1],
    ]);
  });

  it("sorts unknown rows inside project groups before exited and no-agent rows", () => {
    const snapshot = createDashboardSnapshot();
    const web = selectProjectGroups(snapshot, createInitialUiState()).find(
      (group) => group.project.id === "web",
    );

    expect(web?.rows.map((candidate) => candidate.display.statusLabel)).toEqual([
      "needs attention",
      "stuck",
      "working",
      "idle",
      "unknown",
      "exited",
      "no agent",
    ]);
  });

  it("filters by search and collapses project groups without changing snapshot truth", () => {
    const snapshot = createDashboardSnapshot();
    const searched = setSearchQuery(createInitialUiState(), "nav");
    expect(selectVisibleRows(snapshot, searched).map((candidate) => candidate.id)).toEqual([
      "wt_web_idle",
    ]);

    const collapsed = toggleProjectCollapsed(createInitialUiState(), "web");
    const groups = selectProjectGroups(snapshot, collapsed);
    expect(groups.find((group) => group.project.id === "web")?.collapsed).toBe(true);
    expect(selectVisibleRows(snapshot, collapsed).map((candidate) => candidate.projectId)).toEqual([
      "api",
    ]);
  });

  it("assigns stable numeric slots without resolving any selected row", () => {
    const snapshot = createDashboardSnapshot();
    const state = createInitialUiState();
    const slots = selectKeySlots(snapshot, state);

    expect(slots.get("4")?.id).toBe("wt_web_idle");
  });
});
