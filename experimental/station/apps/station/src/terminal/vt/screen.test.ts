import { afterEach, describe, expect, it } from "bun:test";
import { waitFor } from "../testing/waitFor.js";
import { createStationVtScreen, type StationVtScreen } from "./screen.js";

describe("createStationVtScreen", () => {
  const cleanups: Array<() => void> = [];
  const track = (screen: StationVtScreen): StationVtScreen => {
    cleanups.push(() => {
      screen.dispose();
    });
    return screen;
  };
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  it("bumps the version after a write settles", async () => {
    const screen = track(createStationVtScreen({ size: { cols: 20, rows: 5 } }));
    expect(screen.getVersion()).toBe(0);
    screen.feed("hello");
    await waitFor(() => screen.getVersion() >= 1);
  });

  it("coalesces rapid chunks instead of bumping per chunk", async () => {
    const screen = track(
      createStationVtScreen({ size: { cols: 20, rows: 5 }, flushIntervalMs: 150 }),
    );
    for (let index = 0; index < 50; index++) {
      screen.feed(`chunk-${index}\r\n`);
    }
    await screen.whenIdle();
    await waitFor(() => screen.getVersion() >= 1);
    // Leading flush + at most one trailing flush (plus tolerance), never 50.
    expect(screen.getVersion()).toBeLessThanOrEqual(3);
  });

  it("notifies subscribers on flush and stops after unsubscribe", async () => {
    const screen = track(createStationVtScreen({ size: { cols: 20, rows: 5 } }));
    let notified = 0;
    const unsubscribe = screen.subscribe(() => {
      notified += 1;
    });
    screen.feed("a");
    await waitFor(() => notified > 0);

    unsubscribe();
    const seen = notified;
    screen.feed("b");
    await screen.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notified).toBe(seen);
  });

  it("tracks cursor visibility through dectcem", async () => {
    const screen = track(createStationVtScreen({ size: { cols: 20, rows: 5 } }));
    expect(screen.isCursorVisible()).toBe(true);
    screen.feed("\x1b[?25l");
    await screen.whenIdle();
    expect(screen.isCursorVisible()).toBe(false);
    screen.feed("\x1b[?25h");
    await screen.whenIdle();
    expect(screen.isCursorVisible()).toBe(true);
    // Param lists containing 25 count too.
    screen.feed("\x1b[?2004;25l");
    await screen.whenIdle();
    expect(screen.isCursorVisible()).toBe(false);
  });

  it("ris restores cursor visibility", async () => {
    const screen = track(createStationVtScreen({ size: { cols: 20, rows: 5 } }));
    screen.feed("\x1b[?25l");
    await screen.whenIdle();
    expect(screen.isCursorVisible()).toBe(false);
    screen.feed("\x1bc");
    await screen.whenIdle();
    expect(screen.isCursorVisible()).toBe(true);
  });

  it("resize changes the grid and bumps the version", async () => {
    const screen = track(createStationVtScreen({ size: { cols: 20, rows: 5 } }));
    screen.resize({ cols: 100, rows: 40 });
    expect(screen.bufferStats().cols).toBe(100);
    expect(screen.bufferStats().rows).toBe(40);
    await waitFor(() => screen.getVersion() >= 1);
  });

  it("clamps degenerate resizes instead of throwing", () => {
    const screen = track(createStationVtScreen({ size: { cols: 20, rows: 5 } }));
    screen.resize({ cols: 0, rows: 0 });
    expect(screen.bufferStats().cols).toBe(2);
    expect(screen.bufferStats().rows).toBe(1);
  });

  it("dispose is idempotent and silences feed, resize, and subscribers", async () => {
    const screen = createStationVtScreen({ size: { cols: 20, rows: 5 } });
    let notified = 0;
    screen.subscribe(() => {
      notified += 1;
    });
    screen.dispose();
    screen.dispose();
    screen.feed("after dispose");
    screen.resize({ cols: 30, rows: 10 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notified).toBe(0);
  });

  it("answers da1 through the response callback", async () => {
    const responses: string[] = [];
    const screen = track(
      createStationVtScreen({
        size: { cols: 20, rows: 5 },
        onResponse: (data) => {
          responses.push(data);
        },
      }),
    );
    screen.feed("\x1b[c");
    await waitFor(() => responses.join("").includes("\x1b[?1;2c"));
  });

  it("reports cursor position for dsr 6", async () => {
    const responses: string[] = [];
    const screen = track(
      createStationVtScreen({
        size: { cols: 20, rows: 5 },
        onResponse: (data) => {
          responses.push(data);
        },
      }),
    );
    screen.feed("ab\x1b[6n");
    await waitFor(() => /\x1b\[1;3R/.test(responses.join("")));
  });

  // Executable proof of the headless gap: xterm's browser ThemeService is the
  // only OSC color responder upstream, so the store must answer itself.
  it("answers osc 10/11 color queries with theme colors", async () => {
    const responses: string[] = [];
    const screen = track(
      createStationVtScreen({
        size: { cols: 20, rows: 5 },
        theme: {
          foreground: "#d4d4d8",
          background: "#101316",
          ansi16: Array.from({ length: 16 }, () => "#000000"),
        },
        onResponse: (data) => {
          responses.push(data);
        },
      }),
    );
    screen.feed("\x1b]10;?\x07\x1b]11;?\x07");
    await waitFor(() => responses.join("").includes("]10;rgb:d4d4/d4d4/d8d8"));
    await waitFor(() => responses.join("").includes("]11;rgb:1010/1313/1616"));
  });

  it("does not intercept osc color set operations", async () => {
    const responses: string[] = [];
    const screen = track(
      createStationVtScreen({
        size: { cols: 20, rows: 5 },
        onResponse: (data) => {
          responses.push(data);
        },
      }),
    );
    screen.feed("\x1b]10;#ff0000\x07");
    await screen.whenIdle();
    expect(responses.join("")).not.toContain("]10;rgb:");
  });
});
