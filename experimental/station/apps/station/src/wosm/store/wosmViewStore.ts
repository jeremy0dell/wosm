// The WOSM view's store: the ported TuiState machine fed by Station's source
// boundary. A module-level lazy singleton so view state (collapse, search,
// scroll, toasts) survives overlay unmount/remount and the store is reachable
// outside React for the keymap layer and mouse routing. The runtime flags pin
// the popup posture: in Station the WOSM view is always a persistent popup
// whose dismiss is executed by the router (overlay-close outcome) — the
// store-level onDismiss is a recorded no-op so canDismissPopup derives true
// and Q/Esc produce dismissPopup transitions instead of exitCode.
import type { StoreApi } from "zustand/vanilla";
import type { StationWosmStateSource } from "../../sources/types.js";
import { createTuiStore, type TuiStore } from "../ported/state/store.js";
import { createStationStubObserverService } from "./stubObserverService.js";

let instance: StoreApi<TuiStore> | undefined;
let instanceSource: StationWosmStateSource | undefined;

export function getWosmViewStore(source: StationWosmStateSource): StoreApi<TuiStore> {
  if (instance !== undefined && instanceSource !== source) {
    throw new Error(
      "getWosmViewStore was called with a second source; Station has exactly one WOSM state source per process.",
    );
  }
  if (instance === undefined) {
    instance = createWosmViewStore(source);
    instanceSource = source;
    instance.getState().start();
  }
  return instance;
}

/** Fresh store per call — for tests and for explicit ownership in main.tsx. */
export function createWosmViewStore(source: StationWosmStateSource): StoreApi<TuiStore> {
  return createTuiStore({
    source,
    service: createStationStubObserverService(source),
    persistentPopup: true,
    onDismiss: async () => {
      // Dismiss is the router's job: the overlay layer maps the transition's
      // dismissPopup to an overlay-close outcome and executeOutcome closes
      // via the coordination store. This callback exists only so the ported
      // machine sees canDismissPopup=true.
    },
  });
}

/** Test seam: drop the singleton so each test file starts clean. */
export function resetWosmViewStoreForTests(): void {
  instance = undefined;
  instanceSource = undefined;
}
