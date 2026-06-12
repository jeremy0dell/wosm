import { useTerminalDimensions } from "@opentui/react";
import { useCallback } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { MouseTargetRef, StationMouseEvent } from "../input/router.js";
import type { WosmMouseEventKind, WosmMouseTarget } from "./input/wosmMouse.js";
import type { TuiStore } from "./ported/state/store.js";
import { DashboardRoot } from "./view/DashboardRoot.js";
import { WosmMouseProvider, type WosmMouseDispatch } from "./view/wosmMouseContext.js";

export type WosmOverlayProps = {
  /** Owned by main.tsx (HMR recreates store + renderer + handlers together). */
  store: StoreApi<TuiStore>;
  /** The Station input runtime's mouse entry point. */
  dispatchMouse: (target: MouseTargetRef, event: StationMouseEvent) => boolean;
};

/**
 * WOSM mode: the full dashboard at parity with the apps/tui popup (ported
 * logic + OpenTUI render layer under ./). View state lives in the store
 * main.tsx owns, so collapse/search/scroll survive toggling the overlay;
 * the overlay occupies everything under Station's one-row header. Mouse
 * interactions flow renderable -> context -> input runtime -> routeMouse.
 */
export function WosmOverlay({ store, dispatchMouse }: WosmOverlayProps) {
  const { width, height } = useTerminalDimensions();
  const dispatch = useCallback<WosmMouseDispatch>(
    (target: WosmMouseTarget, eventKind: WosmMouseEventKind) => {
      dispatchMouse({ kind: "wosm", target, eventKind }, undefined);
    },
    [dispatchMouse],
  );
  return (
    <WosmMouseProvider value={dispatch}>
      <box width="100%" flexGrow={1} flexDirection="column">
        <DashboardRoot store={store} columns={width} rows={Math.max(1, height - 1)} />
      </box>
    </WosmMouseProvider>
  );
}
