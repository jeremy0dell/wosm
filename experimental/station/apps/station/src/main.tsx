import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useSyncExternalStore } from "react";
import { createStationSequenceHandler, forwardStationPaste } from "./appInput.js";
import { createStationWosmStateSource } from "./sources/createStationWosmStateSource.js";
import { disposeActiveStationTerminal, TerminalPane } from "./terminal/index.js";
import { WosmOverlay } from "./wosm/WosmOverlay.js";

const overlayStore = createOverlayStore();
const wosmSource = createStationWosmStateSource();
let rendererForInput: { destroy(): void } | undefined;
let rootForShutdown: { unmount(): void } | undefined;

function App() {
  const overlayVisible = useSyncExternalStore(
    overlayStore.subscribe,
    overlayStore.getVisible,
    overlayStore.getVisible,
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
        onMouseDown={() => {
          overlayStore.toggle();
        }}
      >
        <text fg="#f4f4f5">{headerText(overlayVisible)}</text>
        <text fg={overlayVisible ? "#101316" : "#f4f4f5"} bg={overlayVisible ? "#4ade80" : "#3f4750"}>
          {overlayVisible ? " [ shell ] " : " [ wosm ] "}
        </text>
      </box>
      {overlayVisible ? <WosmOverlay source={wosmSource} /> : null}
      {/* The pane stays mounted while the overlay is up so the shell process
          survives WOSM mode; it just collapses to zero height. */}
      <box
        width="100%"
        flexGrow={overlayVisible ? 0 : 1}
        height={overlayVisible ? 0 : undefined}
        flexDirection="column"
      >
        <TerminalPane />
      </box>
    </box>
  );
}

function headerText(overlayVisible: boolean): string {
  if (overlayVisible) {
    return " WOSM Station | WOSM mode (read-only) | click header or Ctrl-O for shell | Ctrl-Q exits ";
  }
  return " WOSM Station | shell pane | click header or Ctrl-O for WOSM | Ctrl-Q exits | Ctrl-C → shell ";
}

function createOverlayStore() {
  let visible = false;
  const listeners = new Set<() => void>();
  return {
    getVisible: () => visible,
    toggle: () => {
      visible = !visible;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function shutdownStation(): void {
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
  prependInputHandlers: [
    createStationSequenceHandler({
      isOverlayVisible: () => overlayStore.getVisible(),
      toggleOverlay: () => {
        overlayStore.toggle();
      },
      shutdown: shutdownStation,
    }),
  ],
  useKittyKeyboard: null,
});
rendererForInput = renderer;
// OpenTUI routes paste events around the sequence handlers above, so the
// pane would never see a paste without this explicit forward.
renderer.keyInput.on("paste", (event) => {
  if (forwardStationPaste(event.bytes, { isOverlayVisible: () => overlayStore.getVisible() })) {
    event.preventDefault();
  }
});
const root = createRoot(renderer);
rootForShutdown = root;

wosmSource.start();
root.render(<App />);

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    void wosmSource.stop();
    root.unmount();
    renderer.destroy();
  });
}
