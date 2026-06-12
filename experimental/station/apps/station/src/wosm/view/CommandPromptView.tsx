// OpenTUI port of apps/tui's CommandPrompt: the one-line yellow/red prompt
// for search, collapse, remove-slot/confirm, and rename-slot modes, rendered
// in a fixed status layer above the footer (absolute bottom, like the
// upstream FixedStatusLayer at bottom:3).
import type { TuiScreen } from "../ported/state/types.js";
import { WOSM_COLORS } from "./theme.js";

export function CommandPromptView({ screen }: { screen: TuiScreen }) {
  const line = commandPromptLine(screen);
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

export function commandPromptLine(
  screen: TuiScreen,
): { text: string; color: "yellow" | "red" } | undefined {
  if (screen.name === "renameSession" && screen.step === "chooseSlot") {
    return { text: "Choose the slot to rename: 1-9/a-z", color: "yellow" };
  }
  if (screen.name === "removeWorktree" && screen.step === "confirm") {
    return { text: `confirm ${screen.label}`, color: "red" };
  }
  if (screen.name === "removeWorktree" && screen.step === "chooseSlot") {
    return { text: "remove slot: ", color: "yellow" };
  }
  if (screen.name === "search") {
    return { text: `search: ${screen.value}`, color: "yellow" };
  }
  if (screen.name === "projectCollapse") {
    return { text: `collapse project: ${screen.value}`, color: "yellow" };
  }
  return undefined;
}
