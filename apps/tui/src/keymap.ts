import type { TerminalFocusOrigin, WosmCommand, WosmSnapshot } from "@wosm/contracts";
import {
  type BuildFocusCommandOptions,
  buildPrimaryCommandForRow,
  type CleanupActionKind,
} from "./actions.js";
import { selectKeySlots } from "./selectors.js";
import type { TuiUiState } from "./uiState.js";

export type TuiKeyIntent =
  | { type: "command"; command: WosmCommand }
  | {
      type: "open-cleanup-prompt";
      action: CleanupActionKind;
      rowId: string;
      forceRequired: boolean;
      label: string;
    }
  | { type: "open-new-session-prompt" }
  | { type: "none" };

export type DashboardKeyOptions = {
  focusOrigin?: TerminalFocusOrigin;
};

export function intentForDashboardKey(
  input: string,
  snapshot: WosmSnapshot,
  state: TuiUiState,
  options: DashboardKeyOptions = {},
): TuiKeyIntent {
  if (/^[1-9]$/.test(input)) {
    const row = selectKeySlots(snapshot, state).get(input);
    return row === undefined
      ? { type: "none" }
      : {
          type: "command",
          command: buildPrimaryCommandForRow(row, snapshot, focusCommandOptions(options)),
        };
  }
  if (input === "n") {
    return { type: "open-new-session-prompt" };
  }
  return { type: "none" };
}

function focusCommandOptions(options: DashboardKeyOptions): BuildFocusCommandOptions {
  const built: BuildFocusCommandOptions = {};
  if (options.focusOrigin !== undefined) {
    built.origin = options.focusOrigin;
  }
  return built;
}
