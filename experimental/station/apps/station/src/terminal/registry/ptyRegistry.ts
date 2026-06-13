import type { PaneId } from "../../state/types.js";
import { createNodePtyTerminal } from "../pty/nodePtyTerminal.js";
import type {
  StationTerminalExit,
  StationTerminalProcess,
  StationTerminalSize,
  StationTerminalSpawnOptions,
} from "../types.js";
import { createStationVtScreen, type StationVtScreen } from "../vt/screen.js";

// Mirror of the single-pane POC's debounce (was RESIZE_DEBOUNCE_MS in
// TerminalPane): leading edge for a lone resize, trailing for drag storms.
const DEFAULT_RESIZE_DEBOUNCE_MS = 75;

/**
 * The read-only view a pane id resolves to. `screen` and `terminal` are null
 * until the pane is first laid out (the lazy spawn-on-first-resize); `status`
 * tracks "starting shell" -> `pid N` -> exit text for the pane title.
 */
export type PtyRegistryEntry = {
  readonly paneId: PaneId;
  readonly screen: StationVtScreen | null;
  readonly terminal: StationTerminalProcess | null;
  readonly exited: boolean;
  readonly status: string;
};

export type PtyRegistry = {
  /**
   * Allocate the bookkeeping for a pane. Idempotent, does NOT spawn a PTY, and
   * does NOT notify subscribers: `subscribe` tracks pane *liveness* (spawn,
   * exit, dispose), while pane *membership* is the coordination store's job.
   */
  ensure(paneId: PaneId, spawnOptions?: StationTerminalSpawnOptions): PtyRegistryEntry;
  get(paneId: PaneId): PtyRegistryEntry | undefined;
  has(paneId: PaneId): boolean;
  entries(): readonly PtyRegistryEntry[];
  /** Route input to a pane. Returns false when no live terminal is attached. */
  write(paneId: PaneId, bytes: string): boolean;
  /** Paste to a pane, wrapping per the pane's bracketed-paste state. */
  paste(paneId: PaneId, text: string): boolean;
  /** Debounced; spawns the PTY at the laid-out size on the first call. */
  resize(paneId: PaneId, size: StationTerminalSize): void;
  /** Structural/status changes (spawn, exit, dispose) — NOT screen content. */
  subscribe(listener: () => void): () => void;
  dispose(paneId: PaneId): void;
  disposeAll(): void;
};

export type PtyRegistryOptions = {
  /** Test seam; production uses the node-pty bridge factory. */
  createTerminal?: (options: StationTerminalSpawnOptions) => StationTerminalProcess;
  /** Injectable for deterministic resize-debounce tests. */
  resizeDebounceMs?: number;
};

type InternalEntry = {
  paneId: PaneId;
  screen: StationVtScreen | null;
  terminal: StationTerminalProcess | null;
  exited: boolean;
  spawnFailed: boolean;
  status: string;
  appliedSize: StationTerminalSize | null;
  resizeTimer: ReturnType<typeof setTimeout> | undefined;
  lastResizeAt: number;
  pendingSize: StationTerminalSize | null;
  spawnOptions: StationTerminalSpawnOptions | undefined;
  subscriptions: Array<{ dispose(): void }>;
};

/**
 * Owns the live PTY process and VT screen for every pane, keyed by pane id.
 * This is the runtime resource layer the coordination store delegates to:
 * the store holds only pane records (ids, active, focus), never the process
 * handles or terminal buffers that live here.
 *
 * The single-pane POC kept all of this inside the TerminalPane component ref
 * plus a module-level input-target singleton; generalizing to a registry lets
 * the app hold many PTYs at once while a view renders any one of them.
 */
export function createPtyRegistry(options: PtyRegistryOptions = {}): PtyRegistry {
  const createTerminal = options.createTerminal ?? createNodePtyTerminal;
  const resizeDebounceMs = options.resizeDebounceMs ?? DEFAULT_RESIZE_DEBOUNCE_MS;
  const entries = new Map<PaneId, InternalEntry>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const ensureEntry = (
    paneId: PaneId,
    spawnOptions?: StationTerminalSpawnOptions,
  ): InternalEntry => {
    const existing = entries.get(paneId);
    if (existing !== undefined) {
      return existing;
    }
    const entry: InternalEntry = {
      paneId,
      screen: null,
      terminal: null,
      exited: false,
      spawnFailed: false,
      status: "starting shell",
      appliedSize: null,
      resizeTimer: undefined,
      lastResizeAt: 0,
      pendingSize: null,
      spawnOptions,
      subscriptions: [],
    };
    entries.set(paneId, entry);
    return entry;
  };

  // First-resize lazy spawn: create the screen at the laid-out size, then start
  // the PTY at that same size so there is no corrective resize/SIGWINCH during
  // shell startup, and so panes that are never laid out never spawn a shell.
  const startSession = (entry: InternalEntry, size: StationTerminalSize): void => {
    const screen = createStationVtScreen({
      size,
      onResponse: (data) => {
        // Query replies (DA1/DSR/OSC...) go straight to the PTY: routing them
        // through the keyboard path would tangle them with chord filtering,
        // and TUIs block on these at startup.
        const current = entries.get(entry.paneId);
        if (current?.terminal && !current.exited) {
          current.terminal.write(data);
        }
      },
    });
    entry.screen = screen;
    entry.appliedSize = size;

    let terminal: StationTerminalProcess;
    try {
      terminal = createTerminal({ ...entry.spawnOptions, size });
    } catch (error) {
      entry.spawnFailed = true;
      entry.status = "failed to start shell";
      screen.feed(error instanceof Error ? error.message : "Failed to start shell.");
      notify();
      return;
    }
    entry.terminal = terminal;
    entry.status = `pid ${terminal.pid}`;
    entry.subscriptions.push(
      terminal.onData((data) => {
        entry.screen?.feed(data);
      }),
      terminal.onExit((event) => {
        entry.exited = true;
        entry.status = formatExit(event);
        notify();
      }),
    );
    notify();
  };

  const applyResize = (entry: InternalEntry, size: StationTerminalSize): void => {
    entry.lastResizeAt = Date.now();
    entry.appliedSize = size;
    // Screen first: the app's SIGWINCH-triggered repaint then always meets an
    // already-resized emulator.
    entry.screen?.resize(size);
    if (!entry.exited) {
      entry.terminal?.resize(size);
    }
  };

  const disposeEntry = (entry: InternalEntry): void => {
    if (entry.resizeTimer !== undefined) {
      clearTimeout(entry.resizeTimer);
      entry.resizeTimer = undefined;
    }
    for (const subscription of entry.subscriptions) {
      subscription.dispose();
    }
    entry.subscriptions = [];
    entry.terminal?.dispose();
    entry.screen?.dispose();
    entries.delete(entry.paneId);
  };

  return {
    ensure: (paneId, spawnOptions) => ensureEntry(paneId, spawnOptions),
    get: (paneId) => entries.get(paneId),
    has: (paneId) => entries.has(paneId),
    entries: () => [...entries.values()],

    write: (paneId, bytes) => {
      const entry = entries.get(paneId);
      if (!entry?.terminal || entry.exited) {
        return false;
      }
      entry.terminal.write(bytes);
      return true;
    },

    paste: (paneId, text) => {
      const entry = entries.get(paneId);
      if (!entry?.terminal || entry.exited) {
        return false;
      }
      const bracketed = entry.screen?.isBracketedPasteEnabled() ?? false;
      entry.terminal.write(bracketed ? `\x1b[200~${text}\x1b[201~` : text);
      return true;
    },

    resize: (paneId, size) => {
      const entry = ensureEntry(paneId);
      if (entry.screen === null) {
        startSession(entry, size);
        return;
      }
      if (size.cols === entry.appliedSize?.cols && size.rows === entry.appliedSize?.rows) {
        // A bounce-back to the applied size must also cancel any pending resize,
        // or the stale intermediate size lands when the timer fires.
        entry.pendingSize = null;
        return;
      }
      entry.pendingSize = size;
      if (entry.resizeTimer !== undefined) {
        return;
      }
      // Leading edge for single resizes, trailing for drag storms.
      const elapsed = Date.now() - entry.lastResizeAt;
      const delay = elapsed >= resizeDebounceMs ? 0 : resizeDebounceMs - elapsed;
      entry.resizeTimer = setTimeout(() => {
        entry.resizeTimer = undefined;
        // A timer that fires after the pane was disposed must be a no-op.
        if (entry.pendingSize !== null && entries.get(paneId) === entry) {
          const pending = entry.pendingSize;
          entry.pendingSize = null;
          applyResize(entry, pending);
        }
      }, delay);
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose: (paneId) => {
      const entry = entries.get(paneId);
      if (entry === undefined) {
        return;
      }
      disposeEntry(entry);
      notify();
    },

    disposeAll: () => {
      if (entries.size === 0) {
        return;
      }
      for (const entry of [...entries.values()]) {
        disposeEntry(entry);
      }
      notify();
    },
  };
}

function formatExit(event: StationTerminalExit): string {
  if (event.signal !== undefined && event.signal !== 0) {
    return `exited ${event.exitCode} signal ${event.signal}`;
  }
  return `exited ${event.exitCode}`;
}
