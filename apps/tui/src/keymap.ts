import type { WosmCommand, WosmSnapshot } from "@wosm/contracts";
import { buildFocusCommand, buildPrimaryCommandForRow } from "./actions.js";
import { selectKeySlots, selectSelectedRow } from "./selectors.js";
import type { TuiUiState } from "./uiState.js";

export type TuiKeyIntent =
  | { type: "command"; command: WosmCommand }
  | { type: "open-new-session-prompt" }
  | { type: "none" };

export function intentForDashboardKey(
  input: string,
  snapshot: WosmSnapshot,
  state: TuiUiState,
): TuiKeyIntent {
  if (/^[1-9]$/.test(input)) {
    const row = selectKeySlots(snapshot, state).get(input);
    return row === undefined
      ? { type: "none" }
      : { type: "command", command: buildFocusCommand(row) };
  }
  if (input === "s") {
    const selected = selectSelectedRow(snapshot, state);
    return selected === undefined
      ? { type: "none" }
      : { type: "command", command: buildPrimaryCommandForRow(selected, snapshot) };
  }
  if (input === "n") {
    return { type: "open-new-session-prompt" };
  }
  return { type: "none" };
}
