import { describe, expect, it } from "vitest";
import {
  createDashboardSnapshot,
  createZeroWorktreeSnapshot,
} from "../../test/fixtures/snapshots.js";
import { createInitialTuiState } from "./screen.js";
import { handleTuiKey } from "./transition.js";

describe("TUI screen transitions", () => {
  it("opens remove worktree slot selection from the dashboard", () => {
    const state = createInitialTuiState({ initialSnapshot: createDashboardSnapshot() });
    const transition = handleTuiKey(state, { input: "X" });

    expect(transition.state.screen).toEqual({ name: "removeWorktree", step: "chooseSlot" });
  });

  it("opens remove confirmation for the selected visible row slot", () => {
    const opened = handleTuiKey(
      createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }),
      { input: "X" },
    );
    const transition = handleTuiKey(opened.state, { input: "5" });

    expect(transition.state.screen).toEqual({
      name: "removeWorktree",
      step: "confirm",
      rowId: "wt_web_idle",
      forceRequired: true,
      label: "remove fix-nav-mobile? Y/N",
    });
  });

  it("confirms remove worktree with Y and returns a worktree.remove command", () => {
    const state = handleTuiKey(
      handleTuiKey(createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }), {
        input: "X",
      }).state,
      { input: "5" },
    ).state;

    const transition = handleTuiKey(state, { input: "Y" });

    expect(transition.state.screen).toEqual({ name: "dashboard" });
    expect(transition.commands).toEqual([
      {
        type: "worktree.remove",
        payload: {
          projectId: "web",
          worktreeId: "wt_web_idle",
          force: true,
        },
      },
    ]);
  });

  it.each([
    { input: "N" },
    { input: "", escape: true },
    { input: "\r", return: true },
  ])("cancels remove confirmation without a command", (key) => {
    const state = handleTuiKey(
      handleTuiKey(createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }), {
        input: "X",
      }).state,
      { input: "5" },
    ).state;

    const transition = handleTuiKey(state, key);

    expect(transition.state.screen).toEqual({ name: "dashboard" });
    expect(transition.commands).toBeUndefined();
  });

  it("opens new session from the dashboard and submits a session.create command", () => {
    const opened = handleTuiKey(
      createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }),
      { input: "N" },
    );
    expect(opened.state.screen.name).toBe("newSession");

    const submitted = handleTuiKey(opened.state, { input: "\r", return: true });

    expect(submitted.state.screen).toEqual({ name: "dashboard" });
    expect(submitted.commands?.[0]).toMatchObject({
      type: "session.create",
      payload: {
        projectId: "web",
        terminal: {
          provider: "tmux",
          layout: "agent-build-shell",
          focus: false,
        },
      },
    });
  });

  it("adds a safe error toast when no project exists for a new session", () => {
    const snapshot = {
      ...createZeroWorktreeSnapshot(),
      projects: [],
      counts: {
        ...createZeroWorktreeSnapshot().counts,
        projects: 0,
      },
    };

    const transition = handleTuiKey(createInitialTuiState({ initialSnapshot: snapshot }), {
      input: "N",
    });

    expect(transition.state.screen).toEqual({ name: "dashboard" });
    expect(transition.state.toasts).toEqual([
      expect.objectContaining({
        kind: "error",
        message: "No project is configured for a new session.",
      }),
    ]);
  });
});
