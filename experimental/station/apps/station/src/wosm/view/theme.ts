// Ink color-name -> hex tokens for the WOSM view. The ported layout speaks
// Ink's named RowColor vocabulary (plus the literal purple hex); OpenTUI
// takes fg hex strings. Values match the terminal-ish palette the rest of
// Station already uses.
import { ROW_COLOR_PURPLE, type RowColor } from "../ported/components/WorktreeRow/layout.js";

export const WOSM_COLORS = {
  gray: "#9ca3af",
  red: "#f87171",
  yellow: "#fbbf24",
  green: "#4ade80",
  blue: "#60a5fa",
  purple: ROW_COLOR_PURPLE,
  foreground: "#e4e4e7",
  background: "#101316",
} as const;

export function rowColorToHex(color: RowColor | undefined): string | undefined {
  switch (color) {
    case undefined:
      return undefined;
    case "gray":
      return WOSM_COLORS.gray;
    case "red":
      return WOSM_COLORS.red;
    case "yellow":
      return WOSM_COLORS.yellow;
    case "green":
      return WOSM_COLORS.green;
    case "blue":
      return WOSM_COLORS.blue;
    default:
      // ROW_COLOR_PURPLE is already a hex literal.
      return color;
  }
}
