import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createStationSnapshotSource } from "./sources/createStationSnapshotSource.js";

const snapshotSource = createStationSnapshotSource();
const snapshot = await snapshotSource.getSnapshot();

function App() {
  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#101316">
      <box width="100%" height={1} backgroundColor="#20252b">
        <text fg="#f4f4f5"> WOSM Station </text>
      </box>
      <box width="100%" flexGrow={1} border title="observer snapshot" padding={1}>
        <text fg="#d4d4d8">{JSON.stringify(snapshot, null, 2)}</text>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
});
const root = createRoot(renderer);

root.render(<App />);

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    root.unmount();
    renderer.destroy();
  });
}
