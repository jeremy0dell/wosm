import { useCallback, useEffect, useRef, useState } from "react";
import { createNodePtyTerminal } from "./pty/nodePtyTerminal.js";
import {
  setStationTerminalInputTarget,
  setStationTerminalPasteTarget,
} from "./input/inputTarget.js";
import "./TerminalScreenRenderable.js";
import type {
  StationTerminalExit,
  StationTerminalProcess,
  StationTerminalSize,
  StationTerminalSpawnOptions,
} from "./types.js";
import { createStationVtScreen, type StationVtScreen } from "./vt/screen.js";

const RESIZE_DEBOUNCE_MS = 75;

export type TerminalPaneProps = {
  /** Test seam; production always uses the node-pty bridge factory. */
  createTerminal?: (options: StationTerminalSpawnOptions) => StationTerminalProcess;
};

type PaneSession = {
  screen: StationVtScreen;
  terminal: StationTerminalProcess | null;
  exited: boolean;
  appliedSize: StationTerminalSize;
  resizeTimer: ReturnType<typeof setTimeout> | undefined;
  lastResizeAt: number;
  pendingSize: StationTerminalSize | null;
  subscriptions: Array<{ dispose(): void }>;
};

export function TerminalPane({ createTerminal = createNodePtyTerminal }: TerminalPaneProps) {
  const [screen, setScreen] = useState<StationVtScreen | null>(null);
  const [status, setStatus] = useState("starting shell");
  const sessionRef = useRef<PaneSession | null>(null);
  const unmountedRef = useRef(false);
  const createTerminalRef = useRef(createTerminal);
  createTerminalRef.current = createTerminal;

  const startSession = useCallback((size: StationTerminalSize) => {
    const session: PaneSession = {
      screen: createStationVtScreen({
        size,
        onResponse: (data) => {
          // Query replies (DA1/DSR/OSC...) go straight to the PTY: routing
          // them through the keyboard input path would tangle them with
          // chord filtering, and TUIs block on these at startup.
          const current = sessionRef.current;
          if (current?.terminal && !current.exited) {
            current.terminal.write(data);
          }
        },
      }),
      terminal: null,
      exited: false,
      appliedSize: size,
      resizeTimer: undefined,
      lastResizeAt: 0,
      pendingSize: null,
      subscriptions: [],
    };
    sessionRef.current = session;
    setScreen(session.screen);

    let terminal: StationTerminalProcess;
    try {
      // Spawning at the laid-out size means no corrective resize (and no
      // SIGWINCH) during shell startup.
      terminal = createTerminalRef.current({ size });
    } catch (error) {
      setStatus("failed to start shell");
      session.screen.feed(error instanceof Error ? error.message : "Failed to start shell.");
      return;
    }
    session.terminal = terminal;
    setStatus(`pid ${terminal.pid}`);

    session.subscriptions.push(
      terminal.onData((data) => {
        session.screen.feed(data);
      }),
      terminal.onExit((event) => {
        session.exited = true;
        setStatus(formatExit(event));
        // The input target must not outlive the process: the next keypress
        // would write into a dead bridge.
        setStationTerminalInputTarget(null);
        setStationTerminalPasteTarget(null);
      }),
    );

    setStationTerminalInputTarget(terminal);
    setStationTerminalPasteTarget((text) => {
      const current = sessionRef.current;
      if (!current?.terminal || current.exited) {
        return false;
      }
      const bracketed = current.screen.isBracketedPasteEnabled();
      current.terminal.write(bracketed ? `\x1b[200~${text}\x1b[201~` : text);
      return true;
    });
  }, []);

  const applyResize = useCallback((session: PaneSession, size: StationTerminalSize) => {
    session.lastResizeAt = Date.now();
    session.appliedSize = size;
    // Screen first: the app's SIGWINCH-triggered repaint then always meets an
    // already-resized emulator.
    session.screen.resize(size);
    if (!session.exited) {
      session.terminal?.resize(size);
    }
  }, []);

  const handleViewportResize = useCallback(
    (size: StationTerminalSize) => {
      if (unmountedRef.current) {
        return;
      }
      const session = sessionRef.current;
      if (session === null) {
        startSession(size);
        return;
      }
      if (size.cols === session.appliedSize.cols && size.rows === session.appliedSize.rows) {
        // A bounce-back to the applied size must also cancel any pending
        // resize, or the stale intermediate size lands when the timer fires.
        session.pendingSize = null;
        return;
      }
      session.pendingSize = size;
      if (session.resizeTimer !== undefined) {
        return;
      }
      // Leading edge for single resizes, trailing for drag storms; this also
      // keeps resize work out of OpenTUI's layout pass (onLayoutResize fires
      // mid-layout, where synchronous render requests are dropped).
      const elapsed = Date.now() - session.lastResizeAt;
      const delay = elapsed >= RESIZE_DEBOUNCE_MS ? 0 : RESIZE_DEBOUNCE_MS - elapsed;
      session.resizeTimer = setTimeout(() => {
        session.resizeTimer = undefined;
        if (session.pendingSize !== null && sessionRef.current === session) {
          const pending = session.pendingSize;
          session.pendingSize = null;
          applyResize(session, pending);
        }
      }, delay);
    },
    [applyResize, startSession],
  );

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session === null) {
        return;
      }
      // Input targets first so in-flight keystrokes cannot reach a process
      // that is being torn down.
      setStationTerminalInputTarget(null);
      setStationTerminalPasteTarget(null);
      if (session.resizeTimer !== undefined) {
        clearTimeout(session.resizeTimer);
      }
      for (const subscription of session.subscriptions) {
        subscription.dispose();
      }
      session.terminal?.dispose();
      session.screen.dispose();
    };
  }, []);

  return (
    <box width="100%" flexGrow={1} border title={`terminal ${status}`} padding={1}>
      <terminalScreen
        width="100%"
        flexGrow={1}
        screen={screen}
        onViewportResize={handleViewportResize}
      />
    </box>
  );
}

function formatExit(event: StationTerminalExit): string {
  if (event.signal !== undefined && event.signal !== 0) {
    return `exited ${event.exitCode} signal ${event.signal}`;
  }

  return `exited ${event.exitCode}`;
}
