import { describe, expect, it } from "bun:test";
import { createTuiStore } from "@wosm/dashboard-core";
import { selectActivePaneId, selectWosmOverlayVisible } from "../state/selectors.js";
import { createStationStore } from "../state/store.js";
import { MAIN_PANE_ID, WOSM_OVERLAY_ID, worktreePaneId, type PaneId } from "../state/types.js";
import { createPtyRegistry, type PtyRegistry } from "../terminal/registry/ptyRegistry.js";
import { createScriptedTerminal } from "../terminal/testing/scriptedTerminal.js";
import { manyProjectsSnapshot } from "../wosm/fixtures/scenarios.js";
import { FakeTuiObserverService } from "../wosm/test/support/fakeObserverService.js";
import { FakeStationSource } from "../wosm/test/support/fakeStationSource.js";
import { createStationInputRuntime, normalizeSequence } from "./stationInput.js";

const TMUX_STARTUP_BURST =
  "\x1b]10;rgb:ffff/ffff/ffff\x07" +
  "\x1b]11;rgb:2828/2c2c/3434\x07" +
  "\x1bP>|tmux 3.6b\x1b\\" +
  "\x1b[7;1R\x1b[1;1R\x1b[1;1R" +
  "\x1b[?997;1n" +
  "\x1b[4;2040;2704t";

describe("createStationInputRuntime", () => {
  function harness(options?: { pasteToTerminal?: (paneId: PaneId, text: string) => boolean }) {
    const scripted = createScriptedTerminal();
    const registry = createPtyRegistry({ createTerminal: () => scripted.terminal });
    // First resize spawns the scripted PTY for the initially-focused pane.
    registry.resize(MAIN_PANE_ID, { cols: 36, rows: 8 });
    const store = createStationStore();
    let shutdowns = 0;
    const runtime = createStationInputRuntime({
      store,
      shutdown: () => {
        shutdowns += 1;
      },
      registry,
      pasteToTerminal: options?.pasteToTerminal,
    });
    return { runtime, scripted, store, registry, shutdowns: () => shutdowns };
  }

  it("consumes outer-terminal reply bursts instead of typing them into the shell", () => {
    const { runtime, scripted } = harness();
    expect(runtime.handleSequence(TMUX_STARTUP_BURST)).toBe(true);
    expect(scripted.helpers.writes.length).toBe(0);
  });

  it("forwards the keystroke remainder of a mixed burst", () => {
    const { runtime, scripted } = harness();
    expect(runtime.handleSequence(`x\x1b[1;1R`)).toBe(true);
    expect(scripted.helpers.writes.join("")).toBe("x");
  });

  it("still matches chords delivered in kitty form", () => {
    const { runtime, scripted, store, shutdowns } = harness();
    expect(runtime.handleSequence("\x1b[113;5u")).toBe(true); // Ctrl-Q
    expect(shutdowns()).toBe(1);
    expect(runtime.handleSequence("\x1b[111;5u")).toBe(true); // Ctrl-O
    expect(selectWosmOverlayVisible(store.getState())).toBe(true);
    expect(scripted.helpers.writes.length).toBe(0);
  });

  it("forwards ordinary typing", () => {
    const { runtime, scripted } = harness();
    runtime.handleSequence("l");
    runtime.handleSequence("s");
    runtime.handleSequence("\r");
    expect(scripted.helpers.writes.join("")).toBe("ls\r");
  });

  it("swallows typing while the overlay is open but keeps reserved chords live", () => {
    const { runtime, scripted, store, shutdowns } = harness();
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    expect(runtime.handleSequence("a")).toBe(true);
    expect(scripted.helpers.writes.length).toBe(0);
    expect(runtime.handleSequence("\x11")).toBe(true); // Ctrl-Q pierces the swallow
    expect(shutdowns()).toBe(1);
    expect(runtime.handleSequence("\x0f")).toBe(true); // Ctrl-O closes
    expect(selectWosmOverlayVisible(store.getState())).toBe(false);
  });

  it("returns false for typing when the focused pane has no live terminal, true for chords", () => {
    const { runtime, registry, shutdowns } = harness();
    registry.dispose(MAIN_PANE_ID);
    expect(runtime.handleSequence("a")).toBe(false);
    expect(runtime.handleSequence("\x11")).toBe(true);
    expect(shutdowns()).toBe(1);
  });

  it("toggles the overlay through header mouse dispatch and typing still flows after", () => {
    const { runtime, scripted, store } = harness();
    expect(runtime.dispatchMouse({ kind: "header" }, {})).toBe(true);
    expect(selectWosmOverlayVisible(store.getState())).toBe(true);
    expect(runtime.dispatchMouse({ kind: "header" }, {})).toBe(true);
    expect(selectWosmOverlayVisible(store.getState())).toBe(false);
    runtime.handleSequence("x");
    expect(scripted.helpers.writes.join("")).toBe("x");
  });

  it("prevents default only when a paste was actually delivered", () => {
    const delivered: string[] = [];
    const { runtime, store } = harness({
      pasteToTerminal: (_paneId, text) => {
        delivered.push(text);
        return true;
      },
    });
    let prevented = 0;
    const pasteEvent = (text: string) => ({
      bytes: new TextEncoder().encode(text),
      preventDefault: () => {
        prevented += 1;
      },
    });

    runtime.handlePaste(pasteEvent("hello"));
    expect(delivered).toEqual(["hello"]);
    expect(prevented).toBe(1);

    store.actions.openOverlay(WOSM_OVERLAY_ID);
    runtime.handlePaste(pasteEvent("blocked"));
    expect(delivered).toEqual(["hello"]);
    expect(prevented).toBe(1);
  });

  it("leaves the paste event un-prevented when the focused pane has no live terminal", () => {
    const { runtime, registry } = harness();
    registry.dispose(MAIN_PANE_ID); // registry routing returns false with no live pane
    let prevented = 0;
    runtime.handlePaste({
      bytes: new TextEncoder().encode("orphan"),
      preventDefault: () => {
        prevented += 1;
      },
    });
    expect(prevented).toBe(0);
  });
});

describe("createStationInputRuntime open-pane wiring", () => {
  // wt_wosm_idle -> branch pty-buffer; the fixture derives both ids and path.
  const ROW_ID = "wt_wosm_idle";
  const PANE_ID = worktreePaneId(ROW_ID);
  const CWD = "/Users/example/.worktrees/wosm/pty-buffer";

  function paneHarness(options?: { autoCloseOverlayOnPaneOpen?: boolean }) {
    const snapshot = manyProjectsSnapshot();
    const wosmViewStore = createTuiStore({
      source: new FakeStationSource(snapshot),
      service: new FakeTuiObserverService(snapshot),
      initialSnapshot: snapshot,
      persistentPopup: true,
      onDismiss: async () => {},
      initialState: { terminalRows: 12 },
    });
    const scripted = createScriptedTerminal();
    const base = createPtyRegistry({ createTerminal: () => scripted.terminal });
    const calls: string[] = [];
    const registry: PtyRegistry = {
      ...base,
      ensure: (paneId, spawnOptions) => {
        calls.push(`ensure:${paneId}:${spawnOptions?.cwd ?? ""}`);
        return base.ensure(paneId, spawnOptions);
      },
    };
    const store = createStationStore();
    const origCreate = store.actions.createPane;
    store.actions.createPane = (paneId) => {
      calls.push(`createPane:${paneId}`);
      origCreate(paneId);
    };
    const origReveal = store.actions.revealPane;
    store.actions.revealPane = (paneId) => {
      calls.push(`revealPane:${paneId}`);
      origReveal(paneId);
    };
    const runtime = createStationInputRuntime({
      store,
      shutdown: () => {},
      wosmViewStore,
      registry,
      autoCloseOverlayOnPaneOpen: options?.autoCloseOverlayOnPaneOpen ?? false,
    });
    const clickRowAffordance = (): boolean =>
      runtime.dispatchMouse(
        { kind: "wosm", target: { kind: "openShellForRow", rowId: ROW_ID }, eventKind: "down" },
        {},
      );
    return { runtime, store, calls, clickRowAffordance };
  }

  it("ensures the pane with its cwd before createPane on first open", () => {
    const { store, calls, clickRowAffordance } = paneHarness();
    store.actions.openOverlay(WOSM_OVERLAY_ID);

    expect(clickRowAffordance()).toBe(true);

    expect(calls).toEqual([`ensure:${PANE_ID}:${CWD}`, `createPane:${PANE_ID}`]);
    expect(store.getState().workspace.panes).toContain(PANE_ID);
  });

  it("reuses the running pane via revealPane without a second ensure", () => {
    const { store, calls, clickRowAffordance } = paneHarness();
    store.actions.openOverlay(WOSM_OVERLAY_ID);

    clickRowAffordance();
    clickRowAffordance();

    expect(calls).toEqual([
      `ensure:${PANE_ID}:${CWD}`,
      `createPane:${PANE_ID}`,
      `revealPane:${PANE_ID}`,
    ]);
    // Open-or-focus: exactly one pane record, no second shell.
    expect(store.getState().workspace.panes.filter((id) => id === PANE_ID)).toHaveLength(1);
  });

  it("keeps the overlay up by default, queuing the pane as return focus", () => {
    const { store, clickRowAffordance } = paneHarness();
    store.actions.openOverlay(WOSM_OVERLAY_ID);

    clickRowAffordance();

    expect(selectWosmOverlayVisible(store.getState())).toBe(true);
    expect(selectActivePaneId(store.getState())).toBe(PANE_ID);
    expect(store.getState().input.overlayReturnFocus).toEqual({ kind: "pane", paneId: PANE_ID });
  });

  it("auto-closes the overlay onto the new shell when opted in", () => {
    const { store, clickRowAffordance } = paneHarness({ autoCloseOverlayOnPaneOpen: true });
    store.actions.openOverlay(WOSM_OVERLAY_ID);

    clickRowAffordance();

    expect(selectWosmOverlayVisible(store.getState())).toBe(false);
    expect(store.getState().input.focus).toEqual({ kind: "pane", paneId: PANE_ID });
  });

  // The load-bearing invariant: the cwd seeded by ensure(paneId,{cwd}) before
  // createPane must survive the reconciler's later no-option ensure(paneId) and
  // reach the spawned shell. Exercise it through a real PtyRegistry + a
  // StationApp-equivalent reconciler, then spawn on first resize and assert the
  // captured cwd — closing the gap the plan flagged as manual-smoke-only.
  it("threads the worktree cwd to the spawned shell through the real reconciler", () => {
    const snapshot = manyProjectsSnapshot();
    const wosmViewStore = createTuiStore({
      source: new FakeStationSource(snapshot),
      service: new FakeTuiObserverService(snapshot),
      initialSnapshot: snapshot,
      persistentPopup: true,
      onDismiss: async () => {},
      initialState: { terminalRows: 12 },
    });
    const scripted = createScriptedTerminal();
    const spawns: Array<{ paneCwd: string | undefined }> = [];
    const registry = createPtyRegistry({
      createTerminal: (options) => {
        spawns.push({ paneCwd: options.cwd });
        return scripted.terminal;
      },
    });
    const store = createStationStore();
    // Mirror StationApp.reconcilePanes: ensure (NO options) every member, dispose
    // entries no longer in the store. The no-option ensure is the step that must
    // preserve — not clobber — the cwd seeded by openPane.
    let lastPanes: readonly PaneId[] | undefined;
    const reconcile = (): void => {
      const panes = store.getState().workspace.panes;
      if (panes === lastPanes) {
        return;
      }
      lastPanes = panes;
      for (const paneId of panes) {
        registry.ensure(paneId);
      }
      for (const entry of registry.entries()) {
        if (!panes.includes(entry.paneId)) {
          registry.dispose(entry.paneId);
        }
      }
    };
    store.subscribe(reconcile);
    reconcile();
    const runtime = createStationInputRuntime({ store, shutdown: () => {}, wosmViewStore, registry });
    const expectedCwd = snapshot.rows.find((row) => row.id === ROW_ID)?.path;

    store.actions.openOverlay(WOSM_OVERLAY_ID);
    runtime.dispatchMouse(
      { kind: "wosm", target: { kind: "openShellForRow", rowId: ROW_ID }, eventKind: "down" },
      {},
    );
    // Lazy spawn-on-first-resize: the shell starts here, at the cwd that must
    // have survived openPane's ensure -> createPane -> reconciler's no-option ensure.
    registry.resize(PANE_ID, { cols: 80, rows: 24 });

    expect(typeof expectedCwd).toBe("string");
    expect(spawns.map((spawn) => spawn.paneCwd)).toContain(expectedCwd);
  });
});

describe("normalizeSequence", () => {
  it("consumes pure reply bursts", () => {
    expect(normalizeSequence(TMUX_STARTUP_BURST)).toEqual({ consumed: true });
  });

  it("consumes kitty key releases", () => {
    expect(normalizeSequence("\x1b[111;5:3u")).toEqual({ consumed: true });
  });

  it("translates kitty chords to legacy bytes", () => {
    expect(normalizeSequence("\x1b[111;5u")).toEqual({ consumed: false, legacy: "\x0f" });
  });

  it("passes ordinary bytes through", () => {
    expect(normalizeSequence("a")).toEqual({ consumed: false, legacy: "a" });
  });
});
