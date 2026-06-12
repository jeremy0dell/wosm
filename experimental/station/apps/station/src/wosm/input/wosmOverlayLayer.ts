// The WOSM dashboard's registration into Station's keymap stack: fills the
// "overlay" priority slot that shipped as a read-only swallow placeholder.
// catchAll (not bindings[]) because dashboard keys are mode-dependent — "N"
// opens a sheet in dashboard mode but is text in search mode; the per-mode
// truth lives in the keymap tables + ported machine (wosmKeymap.ts), and
// reserved chords (Ctrl-O/Ctrl-Q) pierce any catchAll by stack rule. Every
// sequence is consumed (modal); dismiss/exit intents surface as the
// overlay-close outcome so the coordination store owns visibility and focus
// restore.
import type { StoreApi } from "zustand/vanilla";
import type { KeymapLayer } from "../../input/keymaps.js";
import type { RouteOutcome } from "../../input/router.js";
import { WOSM_OVERLAY_ID } from "../../state/types.js";
import type { TuiStore } from "../ported/state/store.js";
import { handleWosmSequence } from "./wosmActions.js";

export function createWosmOverlayLayer(
  wosmViewStore: StoreApi<TuiStore>,
): KeymapLayer<RouteOutcome> {
  return {
    id: "overlay",
    isActive: (state) => state.input.activeOverlay === WOSM_OVERLAY_ID,
    bindings: [],
    catchAll: (key) => {
      const outcome = handleWosmSequence(wosmViewStore, key);
      if (outcome.kind === "close-overlay") {
        return { kind: "overlay-close", overlayId: WOSM_OVERLAY_ID };
      }
      return { kind: "swallowed" };
    },
  };
}
