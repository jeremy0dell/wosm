import { useSyncExternalStore } from "react";
import { createStationInputRuntime } from "./input/stationInput.js";
import { selectActivePaneId, selectWosmOverlayVisible } from "./state/selectors.js";
import type { StationStore } from "./state/store.js";
import type { PaneId } from "./state/types.js";
import { TerminalPane } from "./terminal/index.js";
import { createPtyRegistry } from "./terminal/registry/ptyRegistry.js";
import type {
  StationTerminalProcess,
  StationTerminalSpawnOptions,
} from "./terminal/types.js";
import type { StationWosmClient } from "./sources/types.js";
import { createWosmViewStore } from "./wosm/store/wosmViewStore.js";
import { WosmOverlay } from "./wosm/WosmOverlay.js";

export type StationAppCompositionOptions = {
  store: StationStore;
  wosmClient: StationWosmClient;
  shutdown(): void;
  createTerminal?: (options: StationTerminalSpawnOptions) => StationTerminalProcess;
  /**
   * Opt in to closing the WOSM overlay when a `[+sh]` shell pane opens, so the
   * shell is revealed immediately. Default (false) keeps the overlay up and
   * queues the pane as its return focus.
   */
  shellAutoCloseOverlay?: boolean;
};

export function createStationAppComposition(options: StationAppCompositionOptions) {
  const { store, wosmClient } = options;
  const wosmViewStore = createWosmViewStore(wosmClient);
  // The registry owns every pane's PTY + screen. The coordination store holds
  // only pane records; this reconciler keeps the registry's live entries in
  // step with workspace.panes (ensure new ones, dispose removed ones). It runs
  // synchronously on dispatch, not in React's commit phase, so close/create
  // are deterministic even when unmount work cannot flush before exit.
  const registry = createPtyRegistry({ createTerminal: options.createTerminal });
  // The store keeps the same `panes` array reference across focus/overlay/dialog
  // changes (only create/close pane allocate a new one), so gating on identity
  // keeps this off the hot input path — it runs only on real membership changes.
  let lastPanes: readonly PaneId[] | undefined;
  const reconcilePanes = (): void => {
    const panes = store.getState().workspace.panes;
    if (panes === lastPanes) {
      return;
    }
    lastPanes = panes;
    for (const paneId of panes) {
      registry.ensure(paneId);
    }
    for (const entry of registry.entries()) {
      if (!panes.includes(entry.paneId)) {
        registry.dispose(entry.paneId);
      }
    }
  };

  let detachWosmSource: (() => void) | undefined;
  let detachReconcile: (() => void) | undefined;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    detachWosmSource?.();
    detachWosmSource = undefined;
    detachReconcile?.();
    detachReconcile = undefined;
    void wosmClient.stop();
    // React unmount work scheduled during shutdown cannot flush before
    // process.exit, so the live PTYs are disposed imperatively.
    registry.disposeAll();
  };

  const stationInput = createStationInputRuntime({
    store,
    shutdown: () => {
      dispose();
      options.shutdown();
    },
    wosmViewStore,
    registry,
    autoCloseOverlayOnPaneOpen: options.shellAutoCloseOverlay ?? false,
  });

  // Named store snapshots: useSyncExternalStore takes getSnapshot and (unused,
  // no-SSR) getServerSnapshot positionally, so naming them documents intent and
  // lets one getter back both slots. Select scalars only — snapshots are
  // Object.is-compared, so object-building getters would loop.
  const getOverlayVisible = (): boolean => selectWosmOverlayVisible(store.getState());
  const getActivePaneId = () => selectActivePaneId(store.getState());

  function App() {
    const overlayVisible = useSyncExternalStore(
      store.subscribe,
      getOverlayVisible,
      getOverlayVisible,
    );
    const activePaneId = useSyncExternalStore(store.subscribe, getActivePaneId, getActivePaneId);

    return (
      <box width="100%" height="100%" flexDirection="column" backgroundColor="#101316">
        {/* The whole header is a click target for toggling WOSM mode: some
            terminal setups never deliver Ctrl-O (tty discard char, custom
            bindings), so the mouse path must not depend on the keyboard one. */}
        <box
          width="100%"
          height={1}
          backgroundColor="#20252b"
          flexDirection="row"
          justifyContent="space-between"
          onMouseDown={(event) => {
            stationInput.dispatchMouse({ kind: "header" }, event);
          }}
        >
          <text fg="#f4f4f5">{headerText(overlayVisible)}</text>
          <text
            fg={overlayVisible ? "#101316" : "#f4f4f5"}
            bg={overlayVisible ? "#4ade80" : "#3f4750"}
          >
            {overlayVisible ? " [ shell ] " : " [ wosm ] "}
          </text>
        </box>
        {/* The pane keeps its full size while the overlay is up: the WOSM view
            floats above it as a centered popup, the shell stays visible and
            running behind, and clicks on it are guarded by the mouse bindings
            while any overlay is active. The pane is keyed by pane id so the
            active-pane switch remounts the view against the new entry rather
            than mutating props mid-flight (the old pane's PTY keeps running in
            the registry). */}
        <box
          width="100%"
          flexGrow={1}
          flexDirection="column"
          onMouseDown={(event) => {
            const paneId = getActivePaneId();
            if (paneId !== null) {
              stationInput.dispatchMouse({ kind: "pane", paneId }, event);
            }
          }}
        >
          {activePaneId !== null ? (
            <TerminalPane registry={registry} paneId={activePaneId} key={activePaneId} />
          ) : null}
        </box>
        {overlayVisible ? (
          <WosmOverlay store={wosmViewStore} dispatchMouse={stationInput.dispatchMouse} />
        ) : null}
      </box>
    );
  }

  return {
    App,
    stationInput,
    wosmViewStore,
    registry,
    start: (): void => {
      disposed = false;
      // Seed the registry from the initial workspace and keep it reconciled.
      reconcilePanes();
      detachReconcile = store.subscribe(reconcilePanes);
      detachWosmSource = wosmViewStore.getState().start();
      wosmClient.start();
    },
    dispose,
  };
}

function headerText(overlayVisible: boolean): string {
  if (overlayVisible) {
    return " WOSM Station | WOSM mode | click header or Ctrl-O for shell | Ctrl-Q exits ";
  }
  return " WOSM Station | shell pane | click header or Ctrl-O for WOSM | Ctrl-Q exits | Ctrl-C -> shell ";
}
