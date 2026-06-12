// The WOSM view's store: the ported TuiState machine fed by Station's source
// boundary. main.tsx owns the instance (HMR recreates store, renderer, and
// handlers together; view state survives overlay toggles because the store
// outlives the overlay component). The runtime flags pin the popup posture:
// in Station the WOSM view is always a persistent popup whose dismiss is
// executed by the router (overlay-close outcome) — the store-level onDismiss
// is a recorded no-op so canDismissPopup derives true and Q/Esc produce
// dismissPopup transitions instead of exitCode.
import type { StoreApi } from "zustand/vanilla";
import type { StationWosmClient } from "../../sources/types.js";
import type { TuiFolderService } from "../ported/services/folderService.js";
import { createTuiStore, type TuiStore } from "../ported/state/store.js";

export type CreateWosmViewStoreOptions = {
  folderService?: TuiFolderService;
};

export function createWosmViewStore(
  client: StationWosmClient,
  options: CreateWosmViewStoreOptions = {},
): StoreApi<TuiStore> {
  const storeOptions: Parameters<typeof createTuiStore>[0] = {
    source: client.state,
    service: client.service,
    persistentPopup: true,
    onDismiss: async () => {
      // Dismiss is the router's job: the overlay layer maps the transition's
      // dismissPopup to an overlay-close outcome and executeOutcome closes
      // via the coordination store. This callback exists only so the ported
      // machine sees canDismissPopup=true.
    },
  };
  if (options.folderService !== undefined) {
    storeOptions.folderService = options.folderService;
  }
  return createTuiStore(storeOptions);
}
