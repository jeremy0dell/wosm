import { afterEach, describe, expect, it } from "bun:test";
import { TextAttributes } from "@opentui/core";
import { buildVisibleRows } from "./rows.js";
import { createStationVtScreen, type StationVtScreen } from "./screen.js";

describe("buildVisibleRows", () => {
  const cleanups: Array<() => void> = [];
  const screenWith = async (
    feed: string,
    size = { cols: 20, rows: 4 },
  ): Promise<StationVtScreen> => {
    const screen = createStationVtScreen({ size });
    cleanups.push(() => {
      screen.dispose();
    });
    screen.feed(feed);
    await screen.whenIdle();
    return screen;
  };
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  it("merges identically styled cells into one span", async () => {
    const screen = await screenWith("\x1b[31mabc\x1b[0mdef");
    const rows = buildVisibleRows(screen.unsafeEngine, { cursorVisible: false });
    expect(rows[0]?.spans.length).toBe(2);
    expect(rows[0]?.spans[0]).toEqual({
      text: "abc",
      width: 3,
      fg: "#cd3131",
      attributes: 0,
    });
    expect(rows[0]?.spans[1]).toEqual({ text: "def", width: 3, attributes: 0 });
  });

  it("returns one entry per visible row", async () => {
    const screen = await screenWith("hello");
    const rows = buildVisibleRows(screen.unsafeEngine, { cursorVisible: false });
    expect(rows.length).toBe(4);
    expect(rows[1]?.spans).toEqual([]);
  });

  it("paints the cursor cell inverse and hides it on request", async () => {
    const screen = await screenWith("ab");
    const withCursor = buildVisibleRows(screen.unsafeEngine, { cursorVisible: true });
    const cursorSpan = withCursor[0]?.spans[1];
    expect(cursorSpan?.attributes).toBe(TextAttributes.INVERSE);
    expect(cursorSpan?.width).toBe(1);

    const withoutCursor = buildVisibleRows(screen.unsafeEngine, { cursorVisible: false });
    expect(withoutCursor[0]?.spans.length).toBe(1);
  });

  it("flips an inverse cell back to normal under the cursor", async () => {
    const screen = await screenWith("\x1b[7mX\x1b[0m\x1b[1;1H");
    const rows = buildVisibleRows(screen.unsafeEngine, { cursorVisible: true });
    expect(rows[0]?.spans[0]?.attributes).toBe(0);
  });

  it("clamps a pending-wrap cursor into the last column", async () => {
    const screen = await screenWith("x".repeat(20));
    const rows = buildVisibleRows(screen.unsafeEngine, { cursorVisible: true });
    const spans = rows[0]?.spans ?? [];
    const last = spans[spans.length - 1];
    expect(last?.attributes).toBe(TextAttributes.INVERSE);
  });

  it("moves the cursor inversion onto the owning wide cell", async () => {
    // Cursor placed onto the continuation column of a wide char must invert
    // the wide cell itself, not vanish.
    const screen = await screenWith("漢\x1b[1;2H");
    const rows = buildVisibleRows(screen.unsafeEngine, { cursorVisible: true });
    const first = rows[0]?.spans[0];
    expect(first?.text).toBe("漢");
    expect(first?.attributes).toBe(TextAttributes.INVERSE);
  });

  it("skips wide-char continuation cells but counts their width", async () => {
    const screen = await screenWith("漢X");
    const rows = buildVisibleRows(screen.unsafeEngine, { cursorVisible: false });
    const spans = rows[0]?.spans ?? [];
    expect(spans[0]?.text).toBe("漢X");
    expect(spans[0]?.width).toBe(3);
  });

  it("trims trailing plain whitespace but keeps styled whitespace", async () => {
    const screen = await screenWith("\x1b[44m  \x1b[0m   ");
    const rows = buildVisibleRows(screen.unsafeEngine, { cursorVisible: false });
    const spans = rows[0]?.spans ?? [];
    expect(spans.length).toBe(1);
    expect(spans[0]).toEqual({
      text: "  ",
      width: 2,
      bg: "#2472c8",
      attributes: 0,
    });
  });
});
