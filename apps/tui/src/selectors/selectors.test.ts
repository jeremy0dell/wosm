import { describe, expect, it } from "vitest";
import { createDashboardSnapshot } from "../../test/fixtures/snapshots.js";
import { createInitialTuiState, type TuiViewState } from "../state/screen.js";
import {
  choiceValueByKey,
  isSelectionKey,
  keyChoices,
  SELECTION_KEYS,
  selectDashboardRowChoices,
  selectNewSessionHarnessChoices,
  selectNewSessionProjectChoices,
  selectProjectChoices,
  selectProjectGroups,
  selectVisibleRows,
} from "./selectors.js";

describe("TUI selectors", () => {
  it("assigns selection keys in order without 0 or uppercase keys and caps at 35", () => {
    const choices = keyChoices(Array.from({ length: 36 }, (_, index) => index + 1));

    expect(SELECTION_KEYS).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
      "m",
      "n",
      "o",
      "p",
      "q",
      "r",
      "s",
      "t",
      "u",
      "v",
      "w",
      "x",
      "y",
      "z",
    ]);
    expect(choices).toHaveLength(35);
    expect(choices.at(8)).toEqual({ key: "9", value: 9 });
    expect(choices.at(9)).toEqual({ key: "a", value: 10 });
    expect(choices.at(-1)).toEqual({ key: "z", value: 35 });
    expect(isSelectionKey("0")).toBe(false);
    expect(isSelectionKey("A")).toBe(false);
    expect(choiceValueByKey(choices, "0")).toBeUndefined();
    expect(choiceValueByKey(choices, "a")).toBe(10);
  });

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
    const choices = selectDashboardRowChoices(snapshot, state);

    expect(choiceValueByKey(choices, "5")?.id).toBe("wt_web_idle");
  });

  it("skips collapsed project rows when assigning worktree slots", () => {
    const snapshot = createDashboardSnapshot();
    const state = createInitialTuiState({ collapsedProjectIds: ["web"] });
    const choices = selectDashboardRowChoices(snapshot, state);

    expect(choices.map((choice) => [choice.key, choice.value.id])).toEqual([
      ["1", "wt_api_working"],
    ]);
  });

  it("assigns project choices from rendered project headers", () => {
    const snapshot = createDashboardSnapshot();
    const state = createInitialTuiState({ collapsedProjectIds: ["web"] });
    const choices = selectProjectChoices(snapshot, state);

    expect(choices.map((choice) => [choice.key, choice.value.id])).toEqual([
      ["1", "web"],
      ["2", "api"],
    ]);
  });

  it("keys new-session project and harness choices from the same selection grammar", () => {
    const snapshot = {
      ...createDashboardSnapshot(),
      harnesses: [
        { id: "codex", label: "codex" },
        { id: "opencode", label: "opencode" },
        { id: "scripted", label: "scripted" },
      ],
    };
    const api = snapshot.projects.find((project) => project.id === "api");
    if (api === undefined) throw new Error("missing api project");

    expect(
      selectNewSessionProjectChoices(snapshot).map((choice) => [choice.key, choice.value.id]),
    ).toEqual([
      ["1", "web"],
      ["2", "api"],
    ]);
    expect(
      selectNewSessionHarnessChoices(snapshot, api).map((choice) => [choice.key, choice.value.id]),
    ).toEqual([
      ["1", "opencode"],
      ["2", "codex"],
      ["3", "scripted"],
    ]);
  });
});
