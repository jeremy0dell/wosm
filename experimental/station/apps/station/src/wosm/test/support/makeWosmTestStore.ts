import type { WosmClientConnectionState } from "@wosm/client";
import type { WosmSnapshot } from "@wosm/contracts";
import type { StoreApi } from "zustand/vanilla";
import { createTuiStore, type TuiFolderService, type TuiStore } from "@wosm/dashboard-core";
import { manyProjectsSnapshot } from "../../fixtures/scenarios.js";
import { FakeStationSource } from "./fakeStationSource.js";
import { FakeTuiObserverService } from "./fakeObserverService.js";

export type MakeWosmTestStoreOptions = {
  /** Source snapshot; `null` exercises the no-snapshot states. Default: manyProjectsSnapshot(). */
  snapshot?: WosmSnapshot | null | undefined;
  connection?: WosmClientConnectionState | undefined;
  /** Seed the store synchronously instead of waiting for the source mirror. Default: true. */
  seedInitialSnapshot?: boolean | undefined;
  terminalRows?: number | undefined;
  folderService?: TuiFolderService | undefined;
};

export type WosmTestStore = {
  store: StoreApi<TuiStore>;
  source: FakeStationSource;
  service: FakeTuiObserverService;
};

/**
 * The one store builder for WOSM view suites: the production wiring shape
 * (source + service + persistent popup + recorded no-op dismiss) over the
 * controllable fakes, parameterized for the few knobs suites actually vary.
 */
export function makeWosmTestStore(options: MakeWosmTestStoreOptions = {}): WosmTestStore {
  const snapshot =
    options.snapshot === null ? undefined : (options.snapshot ?? manyProjectsSnapshot());
  const source = new FakeStationSource(snapshot, options.connection);
  const service = new FakeTuiObserverService(snapshot ?? manyProjectsSnapshot());
  const store = createTuiStore({
    source,
    service,
    ...(snapshot === undefined || options.seedInitialSnapshot === false
      ? {}
      : { initialSnapshot: snapshot }),
    persistentPopup: true,
    onDismiss: async () => {},
    ...(options.terminalRows === undefined
      ? {}
      : { initialState: { terminalRows: options.terminalRows } }),
    ...(options.folderService === undefined ? {} : { folderService: options.folderService }),
  });
  return { store, source, service };
}
