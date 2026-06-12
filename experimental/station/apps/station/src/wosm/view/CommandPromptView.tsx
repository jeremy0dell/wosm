// OpenTUI port of apps/tui's CommandPrompt: the one-line yellow/red prompt
// for search, collapse, remove-slot/confirm, and rename-slot modes, rendered
// in a fixed status layer above the footer (absolute bottom, like the
// upstream FixedStatusLayer at bottom:3). The prompt copy and color come
// from the shared content module so both apps render the same lines.
import { commandPromptLineForScreen, type TuiScreen } from "@wosm/dashboard-core";
import { WOSM_COLORS } from "./theme.js";

export function CommandPromptView({ screen }: { screen: TuiScreen }) {
  const line = commandPromptLineForScreen(screen);
  if (line === undefined) {
    return null;
  }
  return (
    <box position="absolute" left={0} right={0} bottom={3} zIndex={5} flexDirection="column">
      <text fg={line.color === "red" ? WOSM_COLORS.red : WOSM_COLORS.yellow} bg={WOSM_COLORS.background}>
        {line.text}
      </text>
    </box>
  );
}
