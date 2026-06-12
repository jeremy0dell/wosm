import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createStationAppComposition } from "./StationApp.js";
import { createStationWosmStateSource } from "./sources/createStationWosmStateSource.js";
import { createStationStore } from "./state/store.js";

// main.tsx owns the store and input runtime instances (no module singletons
// elsewhere) so bun --hot recreates store, renderer, and handlers together.
const store = createStationStore();
const wosmSource = createStationWosmStateSource();
const composition = createStationAppComposition({
  store,
  wosmSource,
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
