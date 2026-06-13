import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createStationAppComposition } from "./StationApp.js";
import { createStationWosmClient } from "./sources/createStationWosmClient.js";
import { createStationStore } from "./state/store.js";

declare const Bun: {
  env: Record<string, string | undefined>;
};

// A 1/0/true/false flag in the readSourceName style: opt in to auto-closing
// the WOSM overlay when a `[+sh]` shell pane opens. Unset/empty keeps the
// overlay up (the default).
function readShellAutoCloseOverlay(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value === "false") {
    return false;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  throw new Error(
    `Unsupported WOSM_STATION_SHELL_AUTOCLOSE=${value}. Expected "1"/"true" or "0"/"false".`,
  );
}

// main.tsx owns the store and input runtime instances (no module singletons
// elsewhere) so bun --hot recreates store, renderer, and handlers together.
const store = createStationStore();
const wosmClient = createStationWosmClient();
const composition = createStationAppComposition({
  store,
  wosmClient,
  shellAutoCloseOverlay: readShellAutoCloseOverlay(Bun.env.WOSM_STATION_SHELL_AUTOCLOSE),
  shutdown: () => {
    rootForShutdown?.unmount();
    rendererForInput?.destroy();
    process.exit(0);
  },
});
let rendererForInput: { destroy(): void } | undefined;
let rootForShutdown: { unmount(): void } | undefined;

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  prependInputHandlers: [composition.stationInput.handleSequence],
  useKittyKeyboard: null,
});
rendererForInput = renderer;
// OpenTUI routes paste events around the sequence handlers above, so the
// pane would never see a paste without this explicit forward.
renderer.keyInput.on("paste", (event) => {
  composition.stationInput.handlePaste(event);
});
const root = createRoot(renderer);
rootForShutdown = root;

composition.start();
root.render(<composition.App />);

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    composition.dispose();
    root.unmount();
    renderer.destroy();
  });
}
