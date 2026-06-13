import type { StoreApi } from "zustand/vanilla";
import { WOSM_OVERLAY_ID, type StationState } from "../state/types.js";
import { createWosmOverlayLayer } from "../wosm/input/wosmOverlayLayer.js";
import { routeWosmMouse } from "../wosm/input/wosmMouse.js";
import type { TuiStore } from "@wosm/dashboard-core";
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
 * The pre-dashboard placeholder: everything except reserved chords is
 * swallowed so keystrokes cannot reach the hidden shell pane. Kept for
 * callers without a WOSM view store (tests of the bare stack); the real
 * overlay layer comes from src/wosm/input/wosmOverlayLayer.ts.
 */
const placeholderOverlayLayer: KeymapLayer<RouteOutcome> = {
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
export function createStationKeymap(
  wosmViewStore?: StoreApi<TuiStore>,
): KeymapStack<RouteOutcome> {
  const overlayLayer =
    wosmViewStore === undefined ? placeholderOverlayLayer : createWosmOverlayLayer(wosmViewStore);
  return createKeymapStack([overlayLayer, terminalLayer, workspaceLayer]);
}

/**
 * Header clicks must work while the overlay is open - the mouse path is the
 * documented fallback for terminal setups that never deliver Ctrl-O, so it
 * is guarded only by dialogs, not by the overlay itself. Pane clicks do not
 * focus through a modal.
 */
export function createStationMouseBindings(wosmViewStore?: StoreApi<TuiStore>): MouseBindings {
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
    // WOSM dashboard targets resolve in the view's own pure router against
    // the view store; close-overlay intents surface as router outcomes so
    // the coordination store keeps owning visibility. Hit-testing and wheel
    // direction are the renderable's job, carried in the target ref — the
    // router still never reads event payloads.
    wosm: (target, state) => {
      if (state.input.activeOverlay !== WOSM_OVERLAY_ID || wosmViewStore === undefined) {
        return { kind: "swallowed" };
      }
      const outcome = routeWosmMouse(target.target, target.eventKind, wosmViewStore);
      if (outcome.kind === "close-overlay") {
        return { kind: "overlay-close", overlayId: WOSM_OVERLAY_ID };
      }
      if (outcome.kind === "open-pane") {
        // Explicit assignments keep command/args/worktreeId absent (not set to
        // undefined) on the shell path — exactOptionalPropertyTypes.
        const paneOpen: Extract<RouteOutcome, { kind: "pane-open" }> = {
          kind: "pane-open",
          paneId: outcome.paneId,
          cwd: outcome.cwd,
          role: outcome.role,
        };
        if (outcome.command !== undefined) {
          paneOpen.command = outcome.command;
        }
        if (outcome.args !== undefined) {
          paneOpen.args = outcome.args;
        }
        if (outcome.worktreeId !== undefined) {
          paneOpen.worktreeId = outcome.worktreeId;
        }
        return paneOpen;
      }
      return { kind: "swallowed" };
    },
  };
}
