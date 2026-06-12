import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useSyncExternalStore } from "react";
import { createStationInputRuntime } from "./input/stationInput.js";
import { createStationWosmStateSource } from "./sources/createStationWosmStateSource.js";
import { selectActivePaneId, selectWosmOverlayVisible } from "./state/selectors.js";
import { createStationStore } from "./state/store.js";
import { disposeActiveStationTerminal, TerminalPane } from "./terminal/index.js";
import { createWosmViewStore } from "./wosm/store/wosmViewStore.js";
import { WosmOverlay } from "./wosm/WosmOverlay.js";

// main.tsx owns the store and input runtime instances (no module singletons
// elsewhere) so bun --hot recreates store, renderer, and handlers together.
const store = createStationStore();
const wosmSource = createStationWosmStateSource();
// The WOSM view's state machine; the input runtime registers its overlay
// keymap layer and mouse targets, the overlay component renders from it.
const wosmViewStore = createWosmViewStore(wosmSource);
const detachWosmSource = wosmViewStore.getState().start();
const stationInput = createStationInputRuntime({
  store,
  shutdown: shutdownStation,
  wosmViewStore,
});
let rendererForInput: { destroy(): void } | undefined;
let rootForShutdown: { unmount(): void } | undefined;

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
        <text fg={overlayVisible ? "#101316" : "#f4f4f5"} bg={overlayVisible ? "#4ade80" : "#3f4750"}>
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
        <TerminalPane />
      </box>
      {overlayVisible ? (
        <WosmOverlay store={wosmViewStore} dispatchMouse={stationInput.dispatchMouse} />
      ) : null}
    </box>
  );
}

function headerText(overlayVisible: boolean): string {
  if (overlayVisible) {
    return " WOSM Station | WOSM mode | click header or Ctrl-O for shell | Ctrl-Q exits ";
  }
  return " WOSM Station | shell pane | click header or Ctrl-O for WOSM | Ctrl-Q exits | Ctrl-C → shell ";
}

function shutdownStation(): void {
  detachWosmSource();
  void wosmSource.stop();
  // React unmount work scheduled here cannot flush before process.exit, so
  // the live PTY session is disposed imperatively: this is what actually
  // ends the bridge and the shell, not the unmount.
  disposeActiveStationTerminal();
  rootForShutdown?.unmount();
  rendererForInput?.destroy();
  process.exit(0);
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  prependInputHandlers: [stationInput.handleSequence],
  useKittyKeyboard: null,
});
rendererForInput = renderer;
// OpenTUI routes paste events around the sequence handlers above, so the
// pane would never see a paste without this explicit forward.
renderer.keyInput.on("paste", (event) => {
  stationInput.handlePaste(event);
});
const root = createRoot(renderer);
rootForShutdown = root;

wosmSource.start();
root.render(<App />);

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    detachWosmSource();
    void wosmSource.stop();
    root.unmount();
    renderer.destroy();
  });
}
