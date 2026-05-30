import { describe, expect, it } from "vitest";
import { createDashboardSnapshot } from "../../test/fixtures/snapshots.js";
import { createInitialTuiState, type TuiViewState } from "../state/screen.js";
import {
  selectKeySlots,
  selectProjectGroups,
  selectProjectSlots,
  selectVisibleRows,
} from "./selectors.js";

describe("TUI selectors", () => {
  it("groups rows project-first and keeps zero-worktree projects visible", () => {
    const snapshot = createDashboardSnapshot();
    const groups = selectProjectGroups(snapshot, createInitialTuiState());

    expect(groups.map((group) => [group.project.id, group.rows.length])).toEqual([
      ["web", 7],
      ["api", 1],
    ]);
  });

  it("sorts rows inside project groups by stable branch identity, not live status", () => {
    const snapshot = createDashboardSnapshot();
    const web = selectProjectGroups(snapshot, createInitialTuiState()).find(
      (group) => group.project.id === "web",
    );

    expect(web?.rows.map((candidate) => candidate.branch)).toEqual([
      "cache-refactor",
      "checkout-copy",
      "done-run",
      "feature-auth",
      "fix-nav-mobile",
      "ghost-signal",
      "slow-tests",
    ]);
    expect(web?.rows.map((candidate) => candidate.display.statusLabel)).toEqual([
      "working",
      "needs attention",
      "exited",
      "no agent",
      "idle",
      "unknown",
      "stuck",
    ]);
  });

  it("keeps the same row position when status priority changes", () => {
    const snapshot = createDashboardSnapshot();
    const changed = {
      ...snapshot,
      rows: snapshot.rows.map((candidate) =>
        candidate.id === "wt_web_no_agent"
          ? {
              ...candidate,
              display: {
                statusLabel: "needs attention" as const,
                sortPriority: 10,
                alert: true,
              },
            }
          : candidate,
      ),
    };

    const before = selectProjectGroups(snapshot, createInitialTuiState()).find(
      (group) => group.project.id === "web",
    );
    const after = selectProjectGroups(changed, createInitialTuiState()).find(
      (group) => group.project.id === "web",
    );

    expect(after?.rows.map((candidate) => candidate.id)).toEqual(
      before?.rows.map((candidate) => candidate.id),
    );
  });

  it("filters by search and collapses project groups without changing snapshot truth", () => {
    const snapshot = createDashboardSnapshot();
    const searched: TuiViewState = {
      searchQuery: "nav",
      collapsedProjectIds: new Set(),
    };
    expect(selectVisibleRows(snapshot, searched).map((candidate) => candidate.id)).toEqual([
      "wt_web_idle",
    ]);

    const collapsed: TuiViewState = {
      searchQuery: "",
      collapsedProjectIds: new Set(["web"]),
    };
    const groups = selectProjectGroups(snapshot, collapsed);
    expect(groups.find((group) => group.project.id === "web")?.collapsed).toBe(true);
    expect(selectVisibleRows(snapshot, collapsed).map((candidate) => candidate.projectId)).toEqual([
      "api",
    ]);
  });

  it("assigns stable numeric slots without resolving any selected row", () => {
    const snapshot = createDashboardSnapshot();
    const state = createInitialTuiState();
    const slots = selectKeySlots(snapshot, state);

    expect(slots.get("5")?.id).toBe("wt_web_idle");
  });

  it("skips collapsed project rows when assigning worktree slots", () => {
    const snapshot = createDashboardSnapshot();
    const state = createInitialTuiState({ collapsedProjectIds: ["web"] });
    const slots = selectKeySlots(snapshot, state);

    expect([...slots.entries()].map(([slot, row]) => [slot, row.id])).toEqual([
      ["1", "wt_api_working"],
    ]);
  });

  it("assigns project slots from rendered project headers", () => {
    const snapshot = createDashboardSnapshot();
    const state = createInitialTuiState({ collapsedProjectIds: ["web"] });
    const slots = selectProjectSlots(snapshot, state);

    expect([...slots.entries()].map(([slot, project]) => [slot, project.id])).toEqual([
      ["1", "web"],
      ["2", "api"],
    ]);
  });
});
