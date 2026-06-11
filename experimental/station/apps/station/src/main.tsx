import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { TerminalPane, writeToStationTerminal } from "./terminal/index.js";

const STATION_EXIT_SEQUENCE = "\x11";
let rendererForInput: { destroy(): void } | undefined;

function App() {
  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#101316">
      <box width="100%" height={1} backgroundColor="#20252b">
        <text fg="#f4f4f5">
          {" WOSM Station | shell pane | Ctrl-Q exits Station | Ctrl-C passes to shell "}
        </text>
      </box>
      <TerminalPane />
    </box>
  );
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  prependInputHandlers: [
    (sequence) => {
      if (sequence === STATION_EXIT_SEQUENCE) {
        rendererForInput?.destroy();
        return true;
      }

      return writeToStationTerminal(sequence);
    },
  ],
  useKittyKeyboard: null,
});
rendererForInput = renderer;
const root = createRoot(renderer);

root.render(<App />);

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    root.unmount();
    renderer.destroy();
  });
}
