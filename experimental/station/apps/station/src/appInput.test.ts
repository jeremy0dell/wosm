import { afterEach, describe, expect, it } from "bun:test";
import { createStationSequenceHandler } from "./appInput.js";
import { setStationTerminalInputTarget } from "./terminal/index.js";
import { createScriptedTerminal } from "./terminal/testing/scriptedTerminal.js";

const TMUX_STARTUP_BURST =
  "\x1b]10;rgb:ffff/ffff/ffff\x07" +
  "\x1b]11;rgb:2828/2c2c/3434\x07" +
  "\x1bP>|tmux 3.6b\x1b\\" +
  "\x1b[7;1R\x1b[1;1R\x1b[1;1R" +
  "\x1b[?997;1n" +
  "\x1b[4;2040;2704t";

describe("createStationSequenceHandler", () => {
  afterEach(() => {
    setStationTerminalInputTarget(null);
  });

  function harness() {
    const scripted = createScriptedTerminal();
    setStationTerminalInputTarget(scripted.terminal);
    const state = { overlay: false, shutdowns: 0, toggles: 0 };
    const handler = createStationSequenceHandler({
      isOverlayVisible: () => state.overlay,
      toggleOverlay: () => {
        state.toggles += 1;
      },
      shutdown: () => {
        state.shutdowns += 1;
      },
    });
    return { handler, scripted, state };
  }

  it("consumes outer-terminal reply bursts instead of typing them into the shell", () => {
    const { handler, scripted } = harness();
    expect(handler(TMUX_STARTUP_BURST)).toBe(true);
    expect(scripted.helpers.writes.length).toBe(0);
  });

  it("forwards the keystroke remainder of a mixed burst", () => {
    const { handler, scripted } = harness();
    expect(handler(`x\x1b[1;1R`)).toBe(true);
    expect(scripted.helpers.writes.join("")).toBe("x");
  });

  it("still matches chords delivered in kitty form", () => {
    const { handler, scripted, state } = harness();
    expect(handler("\x1b[113;5u")).toBe(true); // Ctrl-Q
    expect(state.shutdowns).toBe(1);
    expect(handler("\x1b[111;5u")).toBe(true); // Ctrl-O
    expect(state.toggles).toBe(1);
    expect(scripted.helpers.writes.length).toBe(0);
  });

  it("forwards ordinary typing", () => {
    const { handler, scripted } = harness();
    handler("l");
    handler("s");
    handler("\r");
    expect(scripted.helpers.writes.join("")).toBe("ls\r");
  });
});
