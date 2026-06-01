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

  it("scrolls dashboard rows with arrow keys and mouse wheel events", () => {
    const state = createInitialTuiState({
      initialSnapshot: createDashboardSnapshot(),
      terminalRows: 10,
    });

    const down = handleTuiKey(state, { input: "", downArrow: true });
    const wheelDown = handleTuiKey(down.state, { input: "", mouseScroll: "down" });
    const wheelUp = handleTuiKey(wheelDown.state, { input: "", mouseScroll: "up" });

    expect(down.state.scrollOffset).toBe(1);
    expect(wheelDown.state.scrollOffset).toBe(2);
    expect(wheelUp.state.scrollOffset).toBe(1);
  });

  it("clamps dashboard scrolling at the top and bottom", () => {
    const state = createInitialTuiState({
      initialSnapshot: createDashboardSnapshot(),
      scrollOffset: 8,
      terminalRows: 10,
    });

    expect(handleTuiKey(state, { input: "", downArrow: true }).state.scrollOffset).toBe(7);
    expect(
      handleTuiKey({ ...state, scrollOffset: 0 }, { input: "", upArrow: true }).state.scrollOffset,
    ).toBe(0);
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

  it("confirms remove worktree with y and returns a remove operation", () => {
    const state = handleTuiKey(
      handleTuiKey(createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }), {
        input: "X",
      }).state,
      { input: "5" },
    ).state;

    const transition = handleTuiKey(state, { input: "y" });

    expect(transition.state.screen).toEqual({ name: "dashboard" });
    expect(transition.commands).toBeUndefined();
    expect(transition.state.localRows.pendingRemove).toMatchObject([
      {
        localId: "remove:wt_web_idle",
        worktreeId: "wt_web_idle",
        branch: "fix-nav-mobile",
      },
    ]);
    expect(transition.operations).toEqual([
      expect.objectContaining({
        type: "removeWorktree",
        projectId: "web",
        worktreeId: "wt_web_idle",
        branch: "fix-nav-mobile",
        command: {
          type: "worktree.remove",
          payload: {
            projectId: "web",
            worktreeId: "wt_web_idle",
            force: true,
          },
        },
      }),
    ]);
  });

  it("remaps remove slot choices to the visible viewport after scrolling", () => {
    const scrolled = handleTuiKey(
      handleTuiKey(
        handleTuiKey(
          createInitialTuiState({
            initialSnapshot: createDashboardSnapshot(),
            terminalRows: 10,
          }),
          { input: "", downArrow: true },
        ).state,
        { input: "", downArrow: true },
      ).state,
      { input: "X" },
    );

    const transition = handleTuiKey(scrolled.state, { input: "1" });

    expect(transition.state.screen).toMatchObject({
      name: "removeWorktree",
      step: "confirm",
      rowId: "wt_web_attention",
    });
  });

  it.each([
    { input: "n" },
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
    expect(submitted.commands).toBeUndefined();
    expect(submitted.operations?.[0]).toMatchObject({
      type: "createSession",
      projectId: "web",
      command: {
        type: "session.create",
        payload: {
          projectId: "web",
          terminal: {
            provider: "tmux",
            layout: "agent-build-shell",
            focus: false,
          },
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

  it("resets dashboard scroll when a search query is applied", () => {
    const opened = handleTuiKey(
      createInitialTuiState({
        initialSnapshot: createDashboardSnapshot(),
        scrollOffset: 4,
        terminalRows: 10,
      }),
      { input: "/" },
    );
    const typed = handleTuiKey(opened.state, { input: "nav" });
    const transition = handleTuiKey(typed.state, { input: "\r", return: true });

    expect(transition.state.searchQuery).toBe("nav");
    expect(transition.state.scrollOffset).toBe(0);
  });

  it("clamps dashboard scroll after collapsing a project", () => {
    const opened = handleTuiKey(
      createInitialTuiState({
        initialSnapshot: createDashboardSnapshot(),
        scrollOffset: 8,
        terminalRows: 10,
      }),
      { input: "C" },
    );
    const transition = handleTuiKey(opened.state, { input: "1" });

    expect(transition.state.collapsedProjectIds.has("web")).toBe(true);
    expect(transition.state.scrollOffset).toBe(0);
  });
});
