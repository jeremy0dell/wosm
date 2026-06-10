import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useState } from "react";

function App() {
  const [isGreetingHovered, setIsGreetingHovered] = useState(false);

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#101316">
      <box width="100%" height={1} backgroundColor="#20252b">
        <text fg="#f4f4f5"> WOSM Station </text>
      </box>
      <box
        width="100%"
        flexGrow={1}
        border
        title="station mode"
        padding={1}
        justifyContent="center"
        alignItems="center"
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI terminal text is not a DOM element. */}
        {/* biome-ignore lint/a11y/useKeyWithMouseEvents: This spike is explicitly validating terminal mouse hover. */}
        <text
          fg={isGreetingHovered ? "#facc15" : "#9ae6b4"}
          onMouseOver={() => setIsGreetingHovered(true)}
          onMouseOut={() => setIsGreetingHovered(false)}
        >
          {isGreetingHovered ? "Hover active in Station" : "Hello world from Station"}
        </text>
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
