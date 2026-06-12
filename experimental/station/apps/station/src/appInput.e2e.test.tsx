import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { testRender } from "@opentui/react/test-utils";
import { createStationSequenceHandler, forwardStationPaste } from "./appInput.js";
import { createNodePtyTerminal } from "./terminal/pty/nodePtyTerminal.js";
import { TerminalPane } from "./terminal/TerminalPane.js";
import {
  createScriptedTerminal,
  type ScriptedTerminal,
} from "./terminal/testing/scriptedTerminal.js";
import { waitFor } from "./terminal/testing/waitFor.js";
import type {
  StationTerminalProcess,
  StationTerminalSpawnOptions,
} from "./terminal/types.js";

// End-to-end input tests: keystrokes enter through OpenTUI's real input
// pipeline (mock stdin -> parser -> the production sequence handler) and must
// arrive at the pty as the bytes a legacy terminal user would send.

const SURFACE = { width: 70, height: 18 };

type Station = {
  setup: Awaited<ReturnType<typeof testRender>>;
  overlay: { visible: boolean };
  shutdowns: number[];
};

describe("station input end to end", () => {
  const teardowns: Array<() => void> = [];
  afterEach(() => {
    for (const teardown of teardowns.splice(0)) {
      teardown();
    }
  });

  async function renderStation(options: {
    createTerminal: (spawn: StationTerminalSpawnOptions) => StationTerminalProcess;
    kittyKeyboard?: boolean;
  }): Promise<Station> {
    const overlay = { visible: false };
    const shutdowns: number[] = [];
    const handler = createStationSequenceHandler({
      isOverlayVisible: () => overlay.visible,
      toggleOverlay: () => {
        overlay.visible = !overlay.visible;
      },
      shutdown: () => {
        shutdowns.push(1);
      },
    });
    const setup = await testRender(<TerminalPane createTerminal={options.createTerminal} />, {
      ...SURFACE,
      prependInputHandlers: [handler],
      kittyKeyboard: options.kittyKeyboard ?? false,
    });
    // Same paste wiring as main.tsx: OpenTUI routes paste around sequence
    // handlers, so the pane only sees it through this forward.
    setup.renderer.keyInput.on("paste", (event) => {
      if (forwardStationPaste(event.bytes, { isOverlayVisible: () => overlay.visible })) {
        event.preventDefault();
      }
    });
    teardowns.push(() => {
      setup.renderer.destroy();
    });
    await setup.flush();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    return { setup, overlay, shutdowns };
  }

  async function renderScripted(kittyKeyboard: boolean): Promise<Station & {
    scripted: ScriptedTerminal;
  }> {
    const scripted = createScriptedTerminal();
    const station = await renderStation({
      createTerminal: () => scripted.terminal,
      kittyKeyboard,
    });
    await waitFor(() => scripted.helpers.writes !== undefined);
    return { ...station, scripted };
  }

  async function waitForStationFrame(
    station: Station,
    predicate: (frame: string) => boolean,
    timeoutMs = 5_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let frame = "";
    while (true) {
      await station.setup.renderOnce();
      frame = station.setup.captureCharFrame();
      if (predicate(frame)) {
        return frame;
      }
      if (Date.now() > deadline) {
        throw new Error(`frame predicate timed out; last frame:\n${frame}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("typed text reaches the pty byte-for-byte", async () => {
    const station = await renderScripted(false);
    await station.setup.mockInput.typeText("ls -la /tmp");
    await waitFor(() => station.scripted.helpers.writes.join("") === "ls -la /tmp");
  });

  it("enter, escape, and ctrl-c arrive as legacy control bytes", async () => {
    const station = await renderScripted(false);
    station.setup.mockInput.pressEnter();
    station.setup.mockInput.pressEscape();
    station.setup.mockInput.pressCtrlC();
    await waitFor(() => station.scripted.helpers.writes.join("") === "\r\x1b\x03");
  });

  it("kitty-protocol keystrokes still arrive as legacy bytes", async () => {
    const station = await renderScripted(true);
    await station.setup.mockInput.typeText("ab");
    station.setup.mockInput.pressEnter();
    station.setup.mockInput.pressEscape();
    station.setup.mockInput.pressCtrlC();
    await waitFor(() => {
      const bytes = station.scripted.helpers.writes.join("");
      return bytes.includes("ab") && bytes.includes("\r") && bytes.includes("\x1b") && bytes.includes("\x03");
    });
    // No CSI-u garbage leaked into the pty.
    expect(/\x1b\[\d+;\d+u/.test(station.scripted.helpers.writes.join(""))).toBe(false);
  });

  it("ctrl-q triggers shutdown instead of typing into the shell", async () => {
    const station = await renderScripted(true);
    station.setup.mockInput.pressKey("q", { ctrl: true });
    await waitFor(() => station.shutdowns.length === 1);
    expect(station.scripted.helpers.writes.join("")).not.toContain("\x11");
  });

  it("ctrl-o toggles the overlay and the overlay swallows typing", async () => {
    const station = await renderScripted(false);
    station.setup.mockInput.pressKey("o", { ctrl: true });
    await waitFor(() => station.overlay.visible);
    await station.setup.mockInput.typeText("blocked");
    expect(station.scripted.helpers.writes.join("")).not.toContain("blocked");

    station.setup.mockInput.pressKey("o", { ctrl: true });
    await waitFor(() => !station.overlay.visible);
    await station.setup.mockInput.typeText("ok");
    await waitFor(() => station.scripted.helpers.writes.join("").includes("ok"));
  });

  it("paste flows to the pty and respects the child's bracketed-paste mode", async () => {
    const station = await renderScripted(false);
    await station.setup.mockInput.pasteBracketedText("echo pasted");
    await waitFor(() =>
      station.scripted.helpers.writes[station.scripted.helpers.writes.length - 1] ===
        "echo pasted",
    );

    station.scripted.helpers.emitData("\x1b[?2004h");
    await new Promise((resolve) => setTimeout(resolve, 60));
    await station.setup.mockInput.pasteBracketedText("wrapped paste");
    await waitFor(() =>
      station.scripted.helpers.writes[station.scripted.helpers.writes.length - 1] ===
        "\x1b[200~wrapped paste\x1b[201~",
    );
  });

  // --- Real shell lane (gated): a user typing into a live /bin/sh ---

  const ptyGated = (): boolean => {
    if (Bun.env.WOSM_STATION_PTY_SMOKE !== "1") {
      expect(true).toEqual(true);
      return true;
    }
    return false;
  };

  function realShellFactory(spawn: StationTerminalSpawnOptions): StationTerminalProcess {
    return createNodePtyTerminal({
      ...spawn,
      command: "/bin/sh",
      args: ["-i"],
      env: { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PS1: "$ " },
    });
  }

  it("typing a command into a real shell runs it and renders the output", async () => {
    if (ptyGated()) return;
    const station = await renderStation({ createTerminal: realShellFactory });
    await station.setup.mockInput.typeText("printf 'TYPED-OK\\n'");
    station.setup.mockInput.pressEnter();
    await waitForStationFrame(station, (frame) => frame.includes("TYPED-OK"));
  });

  it("ctrl-c interrupts a running command like a real terminal", async () => {
    if (ptyGated()) return;
    const station = await renderStation({ createTerminal: realShellFactory });
    await station.setup.mockInput.typeText("sleep 30");
    station.setup.mockInput.pressEnter();
    await new Promise((resolve) => setTimeout(resolve, 400));
    station.setup.mockInput.pressCtrlC();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await station.setup.mockInput.typeText("printf 'AFTER-INT\\n'");
    station.setup.mockInput.pressEnter();
    // Renders only if the sleep died and the shell prompt came back.
    await waitForStationFrame(station, (frame) => frame.includes("AFTER-INT"), 10_000);
  });

  // --- Real agent lane (extra-gated): codex/claude launched by typing ---

  const agentGated = (): boolean => {
    if (Bun.env.WOSM_STATION_PTY_SMOKE !== "1" || Bun.env.WOSM_STATION_PTY_SMOKE_TUI !== "1") {
      expect(true).toEqual(true);
      return true;
    }
    return false;
  };

  const commandExists = (command: string): boolean =>
    spawnSync("/bin/sh", ["-c", `command -v ${command}`]).status === 0;

  async function runAgentSession(station: Station, launch: string): Promise<void> {
    await station.setup.mockInput.typeText(launch);
    station.setup.mockInput.pressEnter();
    // TUI paint detection: box-drawing/banner glyphs that a plain shell echo
    // of the typed command cannot produce.
    await waitForStationFrame(station, (frame) => /[╭│█▌✻]/.test(frame), 45_000);
    // Let the agent finish initializing; a Ctrl-C during startup can be
    // swallowed and the double-press quit window never opens.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // Quit: both codex and claude exit on a double Ctrl-C. Retry once — the
    // first round can land while the TUI is still busy.
    for (let attempt = 0; attempt < 2; attempt++) {
      station.setup.mockInput.pressCtrlC();
      await new Promise((resolve) => setTimeout(resolve, 600));
      station.setup.mockInput.pressCtrlC();
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      try {
        // The real invariant: the shell is usable again after the session.
        await station.setup.mockInput.typeText("printf 'AGENT-DONE\\n'");
        station.setup.mockInput.pressEnter();
        await waitForStationFrame(station, (frame) => frame.includes("AGENT-DONE"), 15_000);
        return;
      } catch (error) {
        if (attempt === 1) {
          throw error;
        }
      }
    }
  }

  it("claude code launches in the pane by typing and exits cleanly", async () => {
    if (agentGated()) return;
    if (!commandExists("claude")) {
      expect(true).toEqual(true);
      return;
    }
    const station = await renderStation({ createTerminal: realShellFactory });
    await runAgentSession(station, "claude");
  }, 120_000);

  it("codex launches in the pane by typing and exits cleanly", async () => {
    if (agentGated()) return;
    if (!commandExists("codex")) {
      expect(true).toEqual(true);
      return;
    }
    const station = await renderStation({ createTerminal: realShellFactory });
    await runAgentSession(station, "codex");
  }, 120_000);
});
