import { useTerminalDimensions } from "@opentui/react";
import { useCallback } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { MouseTargetRef, StationMouseEvent } from "../input/router.js";
import type { WosmMouseEventKind, WosmMouseTarget } from "./input/wosmMouse.js";
import type { TuiStore } from "./ported/state/store.js";
import { DashboardRoot } from "./view/DashboardRoot.js";
import { WOSM_COLORS } from "./view/theme.js";
import { WosmMouseProvider, type WosmMouseDispatch } from "./view/wosmMouseContext.js";

export type WosmOverlayProps = {
  /** Owned by main.tsx (HMR recreates store + renderer + handlers together). */
  store: StoreApi<TuiStore>;
  /** The Station input runtime's mouse entry point. */
  dispatchMouse: (target: MouseTargetRef, event: StationMouseEvent) => boolean;
};

export type WosmPopupLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const POPUP_FRACTION = 0.5;
const MIN_POPUP_WIDTH = 60;
const MIN_POPUP_HEIGHT = 16;
/** Station's one-row header stays above the popup. */
const HEADER_ROWS = 1;

/**
 * Centered popup geometry over the workspace area below the header, sized
 * like the tmux popup: half the terminal each way, clamped to minimums the
 * dashboard needs (row solver + help panel want ~60 cols) and to the
 * available area on small terminals.
 */
export function wosmPopupLayout(terminalWidth: number, terminalHeight: number): WosmPopupLayout {
  const availableWidth = Math.max(1, terminalWidth);
  const availableHeight = Math.max(1, terminalHeight - HEADER_ROWS);
  const width = Math.min(
    availableWidth,
    Math.max(MIN_POPUP_WIDTH, Math.round(availableWidth * POPUP_FRACTION)),
  );
  const height = Math.min(
    availableHeight,
    Math.max(MIN_POPUP_HEIGHT, Math.round(availableHeight * POPUP_FRACTION)),
  );
  return {
    left: Math.max(0, Math.floor((availableWidth - width) / 2)),
    top: HEADER_ROWS + Math.max(0, Math.floor((availableHeight - height) / 2)),
    width,
    height,
  };
}

/**
 * WOSM mode: the full dashboard at parity with the apps/tui popup (ported
 * logic + OpenTUI render layer under ./), floating as a centered, bordered
 * popup above the still-visible workspace — the spike plan's overlay-above-
 * the-session-workspace shape. View state lives in the store main.tsx owns,
 * so collapse/search/scroll survive toggling the overlay. Mouse interactions
 * flow renderable -> context -> input runtime -> routeMouse; clicks outside
 * the popup are swallowed by the pane guard, not delivered to the shell.
 */
export function WosmOverlay({ store, dispatchMouse }: WosmOverlayProps) {
  const { width, height } = useTerminalDimensions();
  const dispatch = useCallback<WosmMouseDispatch>(
    (target: WosmMouseTarget, eventKind: WosmMouseEventKind) => {
      dispatchMouse({ kind: "wosm", target, eventKind }, undefined);
    },
    [dispatchMouse],
  );
  const layout = wosmPopupLayout(width, height);
  // The border eats one cell per side; the dashboard fills the interior.
  const innerColumns = Math.max(1, layout.width - 2);
  const innerRows = Math.max(1, layout.height - 2);
  return (
    <WosmMouseProvider value={dispatch}>
      <box
        position="absolute"
        left={layout.left}
        top={layout.top}
        width={layout.width}
        height={layout.height}
        zIndex={30}
        border
        borderColor={WOSM_COLORS.gray}
        backgroundColor={WOSM_COLORS.background}
        flexDirection="column"
      >
        <DashboardRoot store={store} columns={innerColumns} rows={innerRows} />
      </box>
    </WosmMouseProvider>
  );
}
