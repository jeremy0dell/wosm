import { WOSM_OVERLAY_ID, type StationState } from "../state/types.js";
import { createKeymapStack, type KeymapLayer, type KeymapStack } from "./keymaps.js";
import type { MouseBindings, RouteOutcome } from "./router.js";

export const STATION_EXIT_LEGACY = "\x11"; // Ctrl-Q
export const OVERLAY_TOGGLE_LEGACY = "\x0f"; // Ctrl-O

function wosmOverlayToggleOutcome(state: StationState): RouteOutcome {
  if (state.input.activeOverlay === WOSM_OVERLAY_ID) {
    return { kind: "overlay-close", overlayId: WOSM_OVERLAY_ID };
  }
  return { kind: "overlay-open", overlayId: WOSM_OVERLAY_ID };
}

/**
 * WOSM mode is read-only: while the overlay is up, everything except
 * reserved chords is swallowed so keystrokes cannot reach the hidden
 * shell pane.
 */
const overlayLayer: KeymapLayer<RouteOutcome> = {
  id: "overlay",
  isActive: (state) => state.input.activeOverlay === WOSM_OVERLAY_ID,
  bindings: [],
  catchAll: () => ({ kind: "swallowed" }),
};

/**
 * Terminal passthrough consumes every non-empty normalized sequence that is
 * not reserved - control bytes, CSI arrows, and escape included, not just
 * printable text. Empty sequences (key releases, untranslatable keys) never
 * reach the router; normalization consumes them first.
 */
const terminalLayer: KeymapLayer<RouteOutcome> = {
  id: "terminal",
  isActive: (state) => state.input.focus.kind === "pane",
  bindings: [],
  catchAll: (key, state) => {
    const focus = state.input.focus;
    if (focus.kind !== "pane") {
      return { kind: "ignored" };
    }
    return { kind: "terminal-write", paneId: focus.paneId, bytes: key };
  },
};

const workspaceLayer: KeymapLayer<RouteOutcome> = {
  id: "workspace",
  isActive: () => true,
  bindings: [
    {
      keys: [STATION_EXIT_LEGACY],
      reserved: true,
      action: () => ({ kind: "command", commandId: "station.exit" }),
    },
    {
      keys: [OVERLAY_TOGGLE_LEGACY],
      reserved: true,
      action: wosmOverlayToggleOutcome,
    },
  ],
};

/** The Phase 1 registration site: adding a Station chord is one binding here. */
export function createStationKeymap(): KeymapStack<RouteOutcome> {
  return createKeymapStack([overlayLayer, terminalLayer, workspaceLayer]);
}

/**
 * Header clicks must work while the overlay is open - the mouse path is the
 * documented fallback for terminal setups that never deliver Ctrl-O, so it
 * is guarded only by dialogs, not by the overlay itself. Pane clicks do not
 * focus through a modal.
 */
export function createStationMouseBindings(): MouseBindings {
  return {
    header: (_target, state) => {
      if (state.input.dialogStack.length > 0) {
        return { kind: "swallowed" };
      }
      return wosmOverlayToggleOutcome(state);
    },
    pane: (target, state) => {
      if (state.input.activeOverlay !== null || state.input.dialogStack.length > 0) {
        return { kind: "swallowed" };
      }
      return { kind: "focus", target: { kind: "pane", paneId: target.paneId } };
    },
  };
}
