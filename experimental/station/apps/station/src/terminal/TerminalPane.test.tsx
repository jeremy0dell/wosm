import { afterEach, describe, expect, it } from "bun:test";
import { rgbToHex, TextAttributes } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { pasteToStationTerminal } from "./input/inputTarget.js";
import { TerminalPane } from "./TerminalPane.js";
import { frameChar, spanAtFrameCell } from "./testing/frameProbe.js";
import { createScriptedTerminal, type ScriptedTerminal } from "./testing/scriptedTerminal.js";
import { waitFor } from "./testing/waitFor.js";
import type { StationTerminalSize } from "./types.js";

// Pane chrome: 1 border + 1 padding on each side. The origin-anchor test
// below derives this empirically; everything else trusts the constant.
const ORIGIN = { x: 2, y: 2 };
const SURFACE = { width: 40, height: 12 };
const GRID = { cols: SURFACE.width - 4, rows: SURFACE.height - 4 };

type PaneSetup = {
  setup: Awaited<ReturnType<typeof testRender>>;
  scripted: ScriptedTerminal;
  spawnSizes: StationTerminalSize[];
};

describe("TerminalPane frame rendering", () => {
  const teardowns: Array<() => void> = [];
  afterEach(() => {
    for (const teardown of teardowns.splice(0)) {
      teardown();
    }
  });

  async function renderPane(): Promise<PaneSetup> {
    const scripted = createScriptedTerminal({ cols: GRID.cols, rows: GRID.rows });
    const spawnSizes: StationTerminalSize[] = [];
    const setup = await testRender(
      <TerminalPane
        createTerminal={(options) => {
          spawnSizes.push({
            cols: options.size?.cols ?? 0,
            rows: options.size?.rows ?? 0,
          });
          return scripted.terminal;
        }}
      />,
      SURFACE,
    );
    teardowns.push(() => {
      setup.renderer.destroy();
    });
    await setup.flush();
    await waitFor(() => spawnSizes.length > 0);
    // Updates after setup are deliberately outside act(): the pane reacts to
    // PTY data on real timers and the tests poll rendered frames instead.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    return { setup, scripted, spawnSizes };
  }

  // The store flushes on a real timer, so frame-waiting must interleave
  // render passes with wall-clock sleeps; OpenTUI's waitForFrame only spins
  // render passes and would exhaust before the flush timer fires.
  async function waitForPaneFrame(
    pane: PaneSetup,
    predicate: (frame: string) => boolean,
    timeoutMs = 2_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let frame = "";
    while (true) {
      await pane.setup.renderOnce();
      frame = pane.setup.captureCharFrame();
      if (predicate(frame)) {
        return frame;
      }
      if (Date.now() > deadline) {
        throw new Error(`frame predicate timed out; last frame:\n${frame}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async function feedAndFlush(pane: PaneSetup, data: string): Promise<void> {
    pane.scripted.helpers.emitData(data);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await pane.setup.renderOnce();
  }

  it("spawns the pty at the laid-out pane interior size", async () => {
    const pane = await renderPane();
    expect(pane.spawnSizes[0]).toEqual({ cols: GRID.cols, rows: GRID.rows });
  });

  it("anchors the grid origin inside border and padding", async () => {
    const pane = await renderPane();
    await feedAndFlush(pane, "ORIGIN");
    const frame = await waitForPaneFrame(pane, (f) => f.includes("ORIGIN"));
    expect(frameChar(frame, ORIGIN.y, ORIGIN.x)).toBe("O");
  });

  it("renders plain output with the pane default foreground", async () => {
    const pane = await renderPane();
    await feedAndFlush(pane, "hello station\r\nline two");
    await waitForPaneFrame(pane, (f) => f.includes("line two"));
    const frame = pane.setup.captureSpans();
    const span = spanAtFrameCell(frame, ORIGIN.y, ORIGIN.x);
    expect(span?.text).toContain("hello station");
    expect(rgbToHex(span?.fg as Parameters<typeof rgbToHex>[0])).toBe("#d4d4d8");
  });

  it("renders sgr colors and attributes as styled cells", async () => {
    const pane = await renderPane();
    await feedAndFlush(pane, "\x1b[1;31mERR\x1b[0m \x1b[38;2;1;2;3mok");
    await waitForPaneFrame(pane, (f) => f.includes("ERR"));
    const frame = pane.setup.captureSpans();
    const errSpan = spanAtFrameCell(frame, ORIGIN.y, ORIGIN.x);
    expect(errSpan?.text).toContain("ERR");
    expect(rgbToHex(errSpan?.fg as Parameters<typeof rgbToHex>[0])).toBe("#cd3131");
    expect((errSpan?.attributes ?? 0) & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
    const okSpan = spanAtFrameCell(frame, ORIGIN.y, ORIGIN.x + 4);
    expect(rgbToHex(okSpan?.fg as Parameters<typeof rgbToHex>[0])).toBe("#010203");
  });

  it("shows the cursor as an inverse cell and hides it on dectcem", async () => {
    const pane = await renderPane();
    await feedAndFlush(pane, "abc");
    await waitForPaneFrame(pane, (f) => f.includes("abc"));
    let frame = pane.setup.captureSpans();
    let cursorSpan = spanAtFrameCell(frame, ORIGIN.y, ORIGIN.x + 3);
    expect((cursorSpan?.attributes ?? 0) & TextAttributes.INVERSE).toBe(TextAttributes.INVERSE);

    await feedAndFlush(pane, "\x1b[?25l");
    frame = pane.setup.captureSpans();
    cursorSpan = spanAtFrameCell(frame, ORIGIN.y, ORIGIN.x + 3);
    expect((cursorSpan?.attributes ?? 0) & TextAttributes.INVERSE).toBe(0);
  });

  it("resize reaches the pty at the new interior size and reflows", async () => {
    const pane = await renderPane();
    await feedAndFlush(pane, "before");
    pane.setup.resize(60, 20);
    await waitFor(() =>
      pane.scripted.helpers.resizes.some((size) => size.cols === 56 && size.rows === 16),
    );
    await feedAndFlush(pane, `\r\n${"=".repeat(56)}`);
    const frame = await waitForPaneFrame(pane, (f) => f.includes("=".repeat(56)));
    expect(frameChar(frame, ORIGIN.y + 1, ORIGIN.x + 55)).toBe("=");
  });

  it("shrinking leaves no stale cells outside the new pane bounds", async () => {
    const pane = await renderPane();
    const fullRow = "#".repeat(GRID.cols);
    await feedAndFlush(pane, Array.from({ length: GRID.rows }, () => fullRow).join("\r\n"));
    await waitForPaneFrame(pane, (f) => f.includes("#"));
    pane.setup.resize(30, 10);
    await waitFor(() =>
      pane.scripted.helpers.resizes.some((size) => size.cols === 26 && size.rows === 6),
    );
    await feedAndFlush(pane, "\x1b[2J\x1b[Hcompact");
    const frame = await waitForPaneFrame(pane, (f) => f.includes("compact"));
    const lines = frame.split("\n");
    for (const line of lines) {
      expect([...line].length).toBeLessThanOrEqual(30);
    }
    expect(frame).not.toContain("#");
  });

  it("alt-screen app takes over and exit restores the primary screen", async () => {
    const pane = await renderPane();
    await feedAndFlush(pane, "primary prompt\r\n");
    await waitForPaneFrame(pane, (f) => f.includes("primary prompt"));

    await feedAndFlush(pane, "\x1b[?1049h\x1b[2J\x1b[H\x1b[7m FAKE-VIM \x1b[0m");
    const altFrame = await waitForPaneFrame(pane, (f) => f.includes("FAKE-VIM"));
    expect(altFrame).not.toContain("primary prompt");
    const frame = pane.setup.captureSpans();
    const headerSpan = spanAtFrameCell(frame, ORIGIN.y, ORIGIN.x + 1);
    expect((headerSpan?.attributes ?? 0) & TextAttributes.INVERSE).toBe(TextAttributes.INVERSE);

    await feedAndFlush(pane, "\x1b[?1049l");
    await waitForPaneFrame(pane, (f) => f.includes("primary prompt"));
  });

  it("device queries round-trip through the pane to the pty", async () => {
    const pane = await renderPane();
    pane.scripted.helpers.emitData("\x1b[c");
    await waitFor(() => pane.scripted.helpers.writes.join("").includes("\x1b[?1;2c"));
  });

  it("stops forwarding query replies after the process exits", async () => {
    const pane = await renderPane();
    pane.scripted.helpers.emitExit({ exitCode: 0 });
    await pane.setup.flush();
    const writesBefore = pane.scripted.helpers.writes.length;
    pane.scripted.helpers.emitData("\x1b[c");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pane.scripted.helpers.writes.length).toBe(writesBefore);
  });

  it("surfaces the exit status in the pane title", async () => {
    const pane = await renderPane();
    pane.scripted.helpers.emitExit({ exitCode: 0 });
    await waitForPaneFrame(pane, (f) => f.includes("exited 0"));
  });

  it("wraps paste only while the child has bracketed paste enabled", async () => {
    const pane = await renderPane();
    expect(pasteToStationTerminal("plain")).toBe(true);
    expect(pane.scripted.helpers.writes[pane.scripted.helpers.writes.length - 1]).toBe("plain");

    await feedAndFlush(pane, "\x1b[?2004h");
    expect(pasteToStationTerminal("wrapped")).toBe(true);
    expect(pane.scripted.helpers.writes[pane.scripted.helpers.writes.length - 1]).toBe(
      "\x1b[200~wrapped\x1b[201~",
    );

    await feedAndFlush(pane, "\x1b[?2004l");
    expect(pasteToStationTerminal("plain again")).toBe(true);
    expect(pane.scripted.helpers.writes[pane.scripted.helpers.writes.length - 1]).toBe(
      "plain again",
    );
  });

  it("rejects paste after the process exits", async () => {
    const pane = await renderPane();
    pane.scripted.helpers.emitExit({ exitCode: 0 });
    await pane.setup.flush();
    const writesBefore = pane.scripted.helpers.writes.length;
    expect(pasteToStationTerminal("late paste")).toBe(false);
    expect(pane.scripted.helpers.writes.length).toBe(writesBefore);
  });

  it("a resize storm settles on the final size, not an intermediate one", async () => {
    const pane = await renderPane();
    pane.setup.resize(60, 20);
    pane.setup.resize(50, 14);
    await waitFor(() =>
      pane.scripted.helpers.resizes.some((size) => size.cols === 46 && size.rows === 10),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const last = pane.scripted.helpers.resizes[pane.scripted.helpers.resizes.length - 1];
    expect(last).toEqual({ cols: 46, rows: 10 });
  });

  it("renders a consistent final frame after a burst", async () => {
    const pane = await renderPane();
    const burst = Array.from({ length: 200 }, (_, index) => `line-${index}`).join("\r\n");
    await feedAndFlush(pane, burst);
    const frame = await waitForPaneFrame(pane, (f) => f.includes("line-199"));
    // The bottom visible grid row holds the last line; earlier rows are the
    // contiguous tail of the scroll, not torn interleavings.
    expect(frameChar(frame, ORIGIN.y + GRID.rows - 1, ORIGIN.x)).toBe("l");
    expect(frame).toContain(`line-${199 - (GRID.rows - 1)}`);
  });
});
