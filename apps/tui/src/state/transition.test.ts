import { describe, expect, it } from "vitest";
import {
  createCommandSnapshot,
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

  it("opens rename slot selection from the dashboard and keeps refresh on Z", () => {
    const state = createInitialTuiState({ initialSnapshot: createDashboardSnapshot() });
    const rename = handleTuiKey(state, { input: "R" });
    const refresh = handleTuiKey(state, { input: "Z" });

    expect(rename.state.screen).toEqual({ name: "renameSession", step: "chooseSlot" });
    expect(refresh.reconcileReason).toBe("tui-refresh");
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

  it("starts an agent from a no-agent dashboard slot as a local operation", () => {
    const transition = handleTuiKey(
      createInitialTuiState({ initialSnapshot: createCommandSnapshot("none") }),
      { input: "1" },
    );

    expect(transition.commands).toBeUndefined();
    expect(transition.state.localRows.pendingStart).toMatchObject([
      {
        localId: "start:wt_web_no_agent",
        projectId: "web",
        worktreeId: "wt_web_no_agent",
        branch: "feature-start",
      },
    ]);
    expect(transition.operations).toEqual([
      expect.objectContaining({
        type: "startAgent",
        localId: "start:wt_web_no_agent",
        projectId: "web",
        worktreeId: "wt_web_no_agent",
        branch: "feature-start",
        command: {
          type: "session.startAgent",
          payload: {
            projectId: "web",
            worktreeId: "wt_web_no_agent",
            terminal: {
              provider: "tmux",
              layout: "agent-build-shell",
              focus: false,
            },
          },
        },
      }),
    ]);
  });

  it("resumes a recoverable dashboard slot as a local operation", () => {
    const snapshot = createCommandSnapshot("none");
    const row = {
      ...snapshot.rows[0],
      recovery: {
        kind: "agent-resume" as const,
        handleId: "rec_codex_123",
        provider: "codex",
        targetKind: "native-session" as const,
        sessionId: "ses_wt_web_no_agent",
        lastSeenAt: "2026-06-01T12:00:00.000Z",
      },
    };
    const transition = handleTuiKey(
      createInitialTuiState({ initialSnapshot: { ...snapshot, rows: [row] } }),
      { input: "1" },
    );

    expect(transition.commands).toBeUndefined();
    expect(transition.state.localRows.pendingStart).toMatchObject([
      {
        localId: "resume:wt_web_no_agent",
        operation: "resumeAgent",
        projectId: "web",
        worktreeId: "wt_web_no_agent",
      },
    ]);
    expect(transition.operations).toEqual([
      expect.objectContaining({
        type: "resumeAgent",
        localId: "resume:wt_web_no_agent",
        command: expect.objectContaining({
          type: "session.resumeAgent",
          payload: expect.objectContaining({
            projectId: "web",
            worktreeId: "wt_web_no_agent",
            recoveryHandleId: "rec_codex_123",
          }),
        }),
      }),
    ]);
  });

  it("keeps agent-backed dashboard slots on the focus command path", () => {
    const transition = handleTuiKey(
      createInitialTuiState({ initialSnapshot: createCommandSnapshot("idle") }),
      { input: "1" },
    );

    expect(transition.operations).toBeUndefined();
    expect(transition.commands).toEqual([
      {
        type: "terminal.focus",
        payload: { sessionId: "ses_wt_web_idle" },
      },
    ]);
    expect(transition.state.localRows.pendingStart).toEqual([]);
  });

  it("ignores a pending-start slot as an action while preserving dashboard state", () => {
    const snapshot = createCommandSnapshot("none");
    const state = createInitialTuiState({
      initialSnapshot: snapshot,
      localRows: {
        pendingCreate: [],
        failedCreate: [],
        pendingRemove: [],
        pendingStart: [
          {
            localId: "start:wt_web_no_agent",
            projectId: "web",
            worktreeId: "wt_web_no_agent",
            branch: "feature-start",
            createdAt: "2026-06-01T12:00:00.000Z",
          },
        ],
      },
    });

    const transition = handleTuiKey(state, { input: "1" });

    expect(transition.state).toBe(state);
    expect(transition.commands).toBeUndefined();
    expect(transition.operations).toBeUndefined();
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

  it("remaps rename slot choices to the visible viewport after scrolling", () => {
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
      { input: "R" },
    );

    const transition = handleTuiKey(scrolled.state, { input: "1" });

    expect(transition.state.screen).toMatchObject({
      name: "renameSession",
      step: "editName",
      rowId: "wt_web_attention",
      sessionId: "ses_wt_web_attention",
      currentTitle: "checkout-copy",
    });
  });

  it("keeps scrolling while choosing a rename slot", () => {
    const opened = handleTuiKey(
      createInitialTuiState({
        initialSnapshot: createDashboardSnapshot(),
        terminalRows: 10,
      }),
      { input: "R" },
    );

    const transition = handleTuiKey(opened.state, { input: "", mouseScroll: "down" });

    expect(transition.state.screen).toEqual({ name: "renameSession", step: "chooseSlot" });
    expect(transition.state.scrollOffset).toBe(1);
  });

  it("shows an error toast when the picked rename row has no session", () => {
    const opened = handleTuiKey(
      createInitialTuiState({ initialSnapshot: createCommandSnapshot("none") }),
      { input: "R" },
    );

    const transition = handleTuiKey(opened.state, { input: "1" });

    expect(transition.state.screen).toEqual({ name: "renameSession", step: "chooseSlot" });
    expect(transition.state.toasts).toEqual([
      expect.objectContaining({
        toast: expect.objectContaining({
          kind: "error",
          message: "No session exists for that row.",
        }),
      }),
    ]);
  });

  it("edits the rename draft at the cursor position", () => {
    const opened = handleTuiKey(
      handleTuiKey(createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }), {
        input: "R",
      }).state,
      { input: "5" },
    ).state;
    const left = handleTuiKey(opened, { input: "", leftArrow: true }).state;
    const inserted = handleTuiKey(left, { input: "!" }).state;

    expect(inserted.screen).toMatchObject({
      name: "renameSession",
      step: "editName",
      draftTitle: {
        value: "fix-nav-mobil!e",
        cursor: "fix-nav-mobil!".length,
      },
    });
  });

  it("keeps the rename sheet open with inline validation for empty titles", () => {
    const opened = handleTuiKey(
      handleTuiKey(createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }), {
        input: "R",
      }).state,
      { input: "5" },
    ).state;
    if (opened.screen.name !== "renameSession" || opened.screen.step !== "editName") {
      throw new Error("expected rename edit screen");
    }
    const state = {
      ...opened,
      screen: {
        ...opened.screen,
        draftTitle: { value: "   ", cursor: 3 },
      },
    };

    const transition = handleTuiKey(state, { input: "\r", return: true });

    expect(transition.state.screen).toEqual({
      ...state.screen,
      validationError: "Session title cannot be empty.",
    });
    expect(transition.state.toasts).toEqual([]);
    expect(transition.operations).toBeUndefined();
  });

  it("clears rename validation when the title is edited", () => {
    const opened = handleTuiKey(
      handleTuiKey(createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }), {
        input: "R",
      }).state,
      { input: "5" },
    ).state;
    if (opened.screen.name !== "renameSession" || opened.screen.step !== "editName") {
      throw new Error("expected rename edit screen");
    }
    const state = {
      ...opened,
      screen: {
        ...opened.screen,
        draftTitle: { value: "", cursor: 0 },
        validationError: "Session title cannot be empty.",
      },
    };

    const transition = handleTuiKey(state, { input: "a" });

    expect(transition.state.screen).toMatchObject({
      name: "renameSession",
      step: "editName",
      draftTitle: { value: "a", cursor: 1 },
    });
    expect(
      transition.state.screen.name === "renameSession" &&
        transition.state.screen.step === "editName"
        ? transition.state.screen.validationError
        : undefined,
    ).toBeUndefined();
  });

  it("closes unchanged rename titles without dispatching", () => {
    const state = handleTuiKey(
      handleTuiKey(createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }), {
        input: "R",
      }).state,
      { input: "5" },
    ).state;

    const transition = handleTuiKey(state, { input: "\r", return: true });

    expect(transition.state.screen).toEqual({ name: "dashboard" });
    expect(transition.operations).toBeUndefined();
  });

  it("submits changed rename titles as an optimistic local operation", () => {
    const state = handleTuiKey(
      handleTuiKey(createInitialTuiState({ initialSnapshot: createDashboardSnapshot() }), {
        input: "R",
      }).state,
      { input: "5" },
    ).state;

    const typed = " updated"
      .split("")
      .reduce((current, input) => handleTuiKey(current, { input }).state, state);
    const transition = handleTuiKey(typed, { input: "\r", return: true });

    expect(transition.state.screen).toEqual({ name: "dashboard" });
    expect(transition.state.localRows.pendingRenameTitles?.ses_wt_web_idle?.title).toBe(
      "fix-nav-mobile updated",
    );
    expect(transition.operations).toEqual([
      {
        type: "renameSession",
        sessionId: "ses_wt_web_idle",
        title: "fix-nav-mobile updated",
        command: {
          type: "session.rename",
          payload: {
            sessionId: "ses_wt_web_idle",
            title: "fix-nav-mobile updated",
          },
        },
      },
    ]);
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
        toast: expect.objectContaining({
          kind: "error",
          message: "No project is configured for a new session.",
        }),
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
