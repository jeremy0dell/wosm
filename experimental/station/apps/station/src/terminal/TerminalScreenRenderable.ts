import {
  type OptimizedBuffer,
  Renderable,
  type RenderableOptions,
  type RenderContext,
  RGBA,
} from "@opentui/core";
import { extend } from "@opentui/react";
import type { StationTerminalSize } from "./types.js";
import type { VtRow } from "./vt/rows.js";
import type { StationVtScreen } from "./vt/screen.js";
import { stationVtTheme } from "./vt/theme.js";

const MIN_COLS = 2;
const MIN_ROWS = 1;

export type TerminalScreenOptions = RenderableOptions<TerminalScreenRenderable> & {
  screen?: StationVtScreen | null;
  /**
   * Fires with the laid-out interior size in cells. This is the source of
   * truth for PTY and screen dimensions: border, padding, and surrounding
   * layout are already absorbed by yoga before this value exists.
   */
  onViewportResize?: (size: StationTerminalSize) => void;
};

export class TerminalScreenRenderable extends Renderable {
  #screen: StationVtScreen | null = null;
  #unsubscribe: (() => void) | null = null;
  #onViewportResize: ((size: StationTerminalSize) => void) | undefined;
  #rows: VtRow[] = [];
  #rowsVersion = -1;

  constructor(ctx: RenderContext, options: TerminalScreenOptions) {
    super(ctx, options);
    this.#onViewportResize = options.onViewportResize;
    this.screen = options.screen ?? null;
  }

  get screen(): StationVtScreen | null {
    return this.#screen;
  }

  set screen(value: StationVtScreen | null) {
    if (this.#screen === value) {
      return;
    }
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#screen = value;
    this.#rowsVersion = -1;
    if (value !== null) {
      this.#unsubscribe = value.subscribe(() => {
        this.requestRender();
      });
    }
    this.requestRender();
  }

  set onViewportResize(handler: ((size: StationTerminalSize) => void) | undefined) {
    this.#onViewportResize = handler;
  }

  protected override onLayoutResize(width: number, height: number): void {
    super.onLayoutResize(width, height);
    // The overlay collapses the pane to zero height while keeping it mounted;
    // reporting that would resize the user's shell to nothing. Degenerate
    // sizes are simply not viewports.
    if (width < MIN_COLS || height < MIN_ROWS) {
      return;
    }
    this.#onViewportResize?.({ cols: width, rows: height });
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const screen = this.#screen;
    if (screen === null || this.width < MIN_COLS || this.height < MIN_ROWS) {
      return;
    }

    const version = screen.getVersion();
    if (version !== this.#rowsVersion) {
      this.#rows = screen.buildRows();
      this.#rowsVersion = version;
    }

    const defaultFg = rgbaForHex(stationVtTheme.foreground);
    const rowLimit = Math.min(this.#rows.length, this.height);
    for (let rowIndex = 0; rowIndex < rowLimit; rowIndex++) {
      const row = this.#rows[rowIndex];
      if (row === undefined) {
        continue;
      }
      let col = 0;
      for (const span of row.spans) {
        if (col >= this.width) {
          break;
        }
        // Spans can exceed the laid-out width only during a resize race
        // (screen still at the old geometry); draw the part that fits rather
        // than dropping the span or painting into neighboring UI.
        const text =
          col + span.width > this.width ? clipSpanText(span, this.width - col) : span.text;
        if (text.length === 0) {
          break;
        }
        buffer.drawText(
          text,
          this.x + col,
          this.y + rowIndex,
          span.fg === undefined ? defaultFg : rgbaForHex(span.fg),
          span.bg === undefined ? undefined : rgbaForHex(span.bg),
          span.attributes,
        );
        col += span.width;
      }
    }
  }

  protected override destroySelf(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#screen = null;
    super.destroySelf();
  }
}

// When every char is width 1 (span.width === code-point count) the clip is an
// exact slice; mixed-width tails (rare, only during a resize race) fall back
// to dropping the span for one frame rather than risking a mis-aligned cut.
function clipSpanText(span: VtRow["spans"][number], budget: number): string {
  if (budget <= 0) {
    return "";
  }
  const codePoints = [...span.text];
  if (codePoints.length !== span.width) {
    return "";
  }
  return codePoints.slice(0, budget).join("");
}

// True-color output can mint a distinct hex per cell; cap the memo so a
// gradient-heavy TUI cannot grow it without bound.
const RGBA_CACHE_LIMIT = 4096;
const rgbaCache = new Map<string, RGBA>();

function rgbaForHex(hex: string): RGBA {
  let rgba = rgbaCache.get(hex);
  if (rgba === undefined) {
    if (rgbaCache.size >= RGBA_CACHE_LIMIT) {
      rgbaCache.clear();
    }
    rgba = RGBA.fromHex(hex);
    rgbaCache.set(hex, rgba);
  }
  return rgba;
}

extend({ terminalScreen: TerminalScreenRenderable });

declare module "@opentui/react" {
  interface OpenTUIComponents {
    terminalScreen: typeof TerminalScreenRenderable;
  }
}
