import { useSyncExternalStore } from "react";
import { createStationInputRuntime } from "./input/stationInput.js";
import { selectActivePaneId, selectWosmOverlayVisible } from "./state/selectors.js";
import type { StationStore } from "./state/store.js";
import { disposeActiveStationTerminal, TerminalPane } from "./terminal/index.js";
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
};

export function createStationAppComposition(options: StationAppCompositionOptions) {
  const { store, wosmClient } = options;
  const wosmViewStore = createWosmViewStore(wosmClient);
  let detachWosmSource: (() => void) | undefined;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    detachWosmSource?.();
    detachWosmSource = undefined;
    void wosmClient.stop();
    // React unmount work scheduled during shutdown cannot flush before
    // process.exit, so the live PTY session is disposed imperatively.
    disposeActiveStationTerminal();
  };

  const stationInput = createStationInputRuntime({
    store,
    shutdown: () => {
      dispose();
      options.shutdown();
    },
    wosmViewStore,
  });

  function App() {
    // Components select scalars only: useSyncExternalStore compares snapshots
    // with Object.is, so object-building selectors would loop.
    const overlayVisible = useSyncExternalStore(
      store.subscribe,
      () => selectWosmOverlayVisible(store.getState()),
      () => selectWosmOverlayVisible(store.getState()),
    );

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
            while any overlay is active. */}
        <box
          width="100%"
          flexGrow={1}
          flexDirection="column"
          onMouseDown={(event) => {
            const paneId = selectActivePaneId(store.getState());
            if (paneId !== null) {
              stationInput.dispatchMouse({ kind: "pane", paneId }, event);
            }
          }}
        >
          {options.createTerminal === undefined ? (
            <TerminalPane />
          ) : (
            <TerminalPane createTerminal={options.createTerminal} />
          )}
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
    start: (): void => {
      disposed = false;
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
