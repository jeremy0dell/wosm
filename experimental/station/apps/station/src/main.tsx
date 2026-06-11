import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useSyncExternalStore } from "react";
import { createStationWosmStateSource } from "./sources/createStationWosmStateSource.js";
import { TerminalPane, writeToStationTerminal } from "./terminal/index.js";
import { WosmOverlay } from "./wosm/WosmOverlay.js";

const STATION_EXIT_SEQUENCE = "\x11";
const WOSM_OVERLAY_TOGGLE_SEQUENCE = "\x0f";

const overlayStore = createOverlayStore();
const wosmSource = createStationWosmStateSource();
let rendererForInput: { destroy(): void } | undefined;

function App() {
  const overlayVisible = useSyncExternalStore(
    overlayStore.subscribe,
    overlayStore.getVisible,
    overlayStore.getVisible,
  );

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#101316">
      <box width="100%" height={1} backgroundColor="#20252b">
        <text fg="#f4f4f5">{headerText(overlayVisible)}</text>
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
    return " WOSM Station | WOSM mode (read-only) | Ctrl-O returns to shell | Ctrl-Q exits ";
  }
  return " WOSM Station | shell pane | Ctrl-O opens WOSM | Ctrl-Q exits | Ctrl-C passes to shell ";
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
  rendererForInput?.destroy();
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  prependInputHandlers: [
    (sequence) => {
      if (sequence === STATION_EXIT_SEQUENCE) {
        shutdownStation();
        return true;
      }

      if (sequence === WOSM_OVERLAY_TOGGLE_SEQUENCE) {
        overlayStore.toggle();
        return true;
      }

      if (overlayStore.getVisible()) {
        // WOSM mode is read-only: swallow input so keystrokes cannot reach
        // the hidden shell pane.
        return true;
      }

      return writeToStationTerminal(sequence);
    },
  ],
  useKittyKeyboard: null,
});
rendererForInput = renderer;
const root = createRoot(renderer);

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
