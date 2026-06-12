import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/headless";
import type { StationTerminalSize } from "../types.js";
import { buildVisibleRows, type VtRow } from "./rows.js";
import { type StationVtTheme, stationVtTheme } from "./theme.js";

const DEFAULT_FLUSH_INTERVAL_MS = 33;
// No scrollback viewing yet; a small buffer keeps resize reflow cheap.
const DEFAULT_SCROLLBACK_LINES = 1000;
// Match xterm's internal resize clamp (and the bridge's) so the PTY and the
// screen model can never disagree on dimensions.
const MIN_COLS = 2;
const MIN_ROWS = 1;

export type StationVtScreenOptions = {
  size: StationTerminalSize;
  scrollback?: number;
  /** Injectable for deterministic coalescing tests. */
  flushIntervalMs?: number;
  theme?: StationVtTheme;
  /**
   * Terminal query replies (DA1/DA2/DSR/CPR/DECRQM from xterm, OSC 10/11 from
   * this store). These must be written back to the PTY verbatim: TUIs block
   * on them at startup.
   */
  onResponse?: (data: string) => void;
};

export type VtCursor = {
  /** Raw column; equals cols while a wrap is pending (DECAWM deferred wrap). */
  x: number;
  /** Viewport-relative row. */
  y: number;
};

export type VtBufferStats = {
  cols: number;
  rows: number;
  /** Lines pushed into scrollback (0 = none). */
  baseY: number;
  /** Total buffer lines including scrollback. */
  length: number;
};

// The engine (xterm) must not escape this type: everything above vt/ consumes
// this view, which is what keeps the conformance catalog and the renderer
// engine-agnostic if the engine is ever swapped.
export type StationVtScreen = {
  feed(data: string): void;
  resize(size: StationTerminalSize): void;
  /** Style-merged spans for the visible viewport, cursor composited in. */
  buildRows(options?: { cursorVisible?: boolean }): VtRow[];
  isCursorVisible(): boolean;
  /** DECSET 2004 state; decides paste wrapping. */
  isBracketedPasteEnabled(): boolean;
  /** Right-trimmed text of a visible row. */
  rowText(index: number): string;
  cursor(): VtCursor;
  isAltScreen(): boolean;
  bufferStats(): VtBufferStats;
  subscribe(listener: () => void): () => void;
  /** Monotonic version bumped on each coalesced screen update. */
  getVersion(): number;
  /** Resolves after everything fed so far has been parsed. */
  whenIdle(): Promise<void>;
  /**
   * Test/diagnostic-only escape hatch to the underlying engine. Production
   * code must consume the view methods above instead.
   */
  readonly unsafeEngine: Terminal;
  dispose(): void;
};

export function createStationVtScreen(options: StationVtScreenOptions): StationVtScreen {
  const theme = options.theme ?? stationVtTheme;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const terminal = new Terminal({
    cols: Math.max(options.size.cols, MIN_COLS),
    rows: Math.max(options.size.rows, MIN_ROWS),
    scrollback: options.scrollback ?? DEFAULT_SCROLLBACK_LINES,
    allowProposedApi: true,
  });
  // Headless xterm defaults to Unicode 6 widths; OpenTUI measures with modern
  // tables. Without this, every cell after an emoji drifts one column.
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";

  let version = 0;
  let cursorVisible = true;
  let disposed = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFlushAt = 0;
  const listeners = new Set<() => void>();

  const emitResponse = (data: string): void => {
    if (!disposed) {
      options.onResponse?.(data);
    }
  };

  // xterm answers DA1/DA2/DSR/CPR/DECRQM/DECRQSS internally; in headless the
  // replies surface only on onData and are dropped unless forwarded.
  terminal.onData(emitResponse);

  // Headless xterm does NOT answer OSC 10/11 color queries (the replying
  // ThemeService is browser-only), but termenv/lipgloss-based TUIs wait on
  // them for background detection. Answer with Station's theme; non-query
  // payloads fall through to xterm's own color tracking.
  terminal.parser.registerOscHandler(10, (data) => {
    if (data !== "?") {
      return false;
    }
    emitResponse(`\x1b]10;${toOscRgb(theme.foreground)}\x07`);
    return true;
  });
  terminal.parser.registerOscHandler(11, (data) => {
    if (data !== "?") {
      return false;
    }
    emitResponse(`\x1b]11;${toOscRgb(theme.background)}\x07`);
    return true;
  });

  // The headless buffer API does not expose DECTCEM cursor visibility, so
  // track ?25h/?25l ourselves; returning false keeps default processing.
  terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    if (paramListIncludes(params, 25)) {
      cursorVisible = true;
    }
    return false;
  });
  terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
    if (paramListIncludes(params, 25)) {
      cursorVisible = false;
    }
    return false;
  });
  // RIS and DECSTR both restore a visible cursor; without these a `reset`
  // after a cursor-hiding app leaves the pane cursorless forever.
  terminal.parser.registerEscHandler({ final: "c" }, () => {
    cursorVisible = true;
    return false;
  });
  terminal.parser.registerCsiHandler({ intermediates: "!", final: "p" }, () => {
    cursorVisible = true;
    return false;
  });

  const flush = (): void => {
    flushTimer = undefined;
    if (disposed) {
      return;
    }
    lastFlushAt = Date.now();
    version += 1;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const scheduleFlush = (): void => {
    if (disposed || flushTimer !== undefined) {
      return;
    }
    const elapsed = Date.now() - lastFlushAt;
    flushTimer = setTimeout(flush, elapsed >= flushIntervalMs ? 0 : flushIntervalMs - elapsed);
  };

  terminal.onWriteParsed(scheduleFlush);

  return {
    feed: (data) => {
      if (disposed) {
        return;
      }
      terminal.write(data);
    },
    resize: (size) => {
      if (disposed) {
        return;
      }
      terminal.resize(Math.max(size.cols, MIN_COLS), Math.max(size.rows, MIN_ROWS));
      scheduleFlush();
    },
    buildRows: (rowOptions) =>
      buildVisibleRows(terminal, {
        cursorVisible: rowOptions?.cursorVisible ?? cursorVisible,
      }),
    isCursorVisible: () => cursorVisible,
    isBracketedPasteEnabled: () => terminal.modes.bracketedPasteMode,
    rowText: (index) => {
      const buffer = terminal.buffer.active;
      return buffer.getLine(buffer.baseY + index)?.translateToString(true) ?? "";
    },
    cursor: () => {
      const buffer = terminal.buffer.active;
      return { x: buffer.cursorX, y: buffer.cursorY };
    },
    isAltScreen: () => terminal.buffer.active.type === "alternate",
    bufferStats: () => ({
      cols: terminal.cols,
      rows: terminal.rows,
      baseY: terminal.buffer.active.baseY,
      length: terminal.buffer.active.length,
    }),
    get unsafeEngine() {
      return terminal;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
    whenIdle: () => {
      if (disposed) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        terminal.write("", resolve);
      });
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      listeners.clear();
      terminal.dispose();
    },
  };
}

function paramListIncludes(params: (number | number[])[], target: number): boolean {
  return params.some((param) =>
    Array.isArray(param) ? param.includes(target) : param === target,
  );
}

/** "#d4d4d8" -> "rgb:d4d4/d4d4/d8d8" (xterm's 16-bit-per-channel reply form). */
function toOscRgb(hexColor: string): string {
  const r = hexColor.slice(1, 3);
  const g = hexColor.slice(3, 5);
  const b = hexColor.slice(5, 7);
  return `rgb:${r}${r}/${g}${g}/${b}${b}`;
}
