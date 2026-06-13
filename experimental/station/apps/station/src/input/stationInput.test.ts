import { describe, expect, it } from "bun:test";
import { selectWosmOverlayVisible } from "../state/selectors.js";
import { createStationStore } from "../state/store.js";
import { MAIN_PANE_ID, WOSM_OVERLAY_ID, type PaneId } from "../state/types.js";
import { createPtyRegistry } from "../terminal/registry/ptyRegistry.js";
import { createScriptedTerminal } from "../terminal/testing/scriptedTerminal.js";
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
