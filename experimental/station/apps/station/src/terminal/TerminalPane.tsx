import { useEffect, useSyncExternalStore } from "react";
import "./TerminalScreenRenderable.js";
import type { PaneId } from "../state/types.js";
import type { PtyRegistry } from "./registry/ptyRegistry.js";
import type { StationTerminalSize } from "./types.js";

export type TerminalPaneProps = {
  /** Runtime resources for every pane; this view binds one pane id. */
  registry: PtyRegistry;
  paneId: PaneId;
};

/**
 * A thin view over one pane's registry entry: it binds the pane's VT screen to
 * the renderable and forwards viewport resizes. The registry owns the PTY
 * process and its lifecycle — this component never spawns or disposes it. In
 * particular, unmounting (e.g. when the active pane switches) must not tear the
 * PTY down, or a live background pane would die on every switch.
 */
export function TerminalPane({ registry, paneId }: TerminalPaneProps) {
  useEffect(() => {
    // Idempotent: guarantees the entry exists for the snapshots below even when
    // no reconciler created it first (the input e2e path renders a bare pane).
    registry.ensure(paneId);
  }, [registry, paneId]);

  // Named snapshots (one getter backs both the getSnapshot and unused, no-SSR
  // getServerSnapshot slots). Screen and status are scalars the registry
  // refreshes on spawn/exit; screen *content* updates flow through the
  // renderable's own subscription, not these.
  const getScreen = () => registry.get(paneId)?.screen ?? null;
  const getStatus = () => registry.get(paneId)?.status ?? "starting shell";
  const screen = useSyncExternalStore(registry.subscribe, getScreen, getScreen);
  const status = useSyncExternalStore(registry.subscribe, getStatus, getStatus);

  const handleViewportResize = (size: StationTerminalSize): void => {
    registry.resize(paneId, size);
  };

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
