import type { TerminalFocusOrigin, WosmCommand, WosmSnapshot } from "@wosm/contracts";
import {
  type BuildFocusCommandOptions,
  buildFocusCommand,
  buildPrimaryCommandForRow,
  type CleanupActionKind,
  cleanupForceRequired,
} from "./actions.js";
import { selectKeySlots, selectSelectedRow } from "./selectors.js";
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
      : { type: "command", command: buildFocusCommand(row, focusCommandOptions(options)) };
  }
  if (input === "enter") {
    const selected = selectSelectedRow(snapshot, state);
    return selected === undefined
      ? { type: "none" }
      : { type: "command", command: buildFocusCommand(selected, focusCommandOptions(options)) };
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
  const cleanupAction = cleanupActionForKey(input);
  if (cleanupAction !== undefined) {
    const selected = selectSelectedRow(snapshot, state);
    if (selected === undefined) {
      return { type: "none" };
    }
    return {
      type: "open-cleanup-prompt",
      action: cleanupAction,
      rowId: selected.id,
      forceRequired: cleanupForceRequired(selected, cleanupAction),
      label: cleanupLabel(cleanupAction),
    };
  }
  return { type: "none" };
}

function cleanupActionForKey(input: string): CleanupActionKind | undefined {
  if (input === "a") return "close-harness";
  if (input === "t") return "close-terminal";
  if (input === "c") return "close-all";
  if (input === "x") return "remove-worktree";
  return undefined;
}

function cleanupLabel(action: CleanupActionKind): string {
  if (action === "close-harness") return "close agent";
  if (action === "close-terminal") return "close terminal";
  if (action === "close-all") return "close all";
  return "remove worktree";
}

function focusCommandOptions(options: DashboardKeyOptions): BuildFocusCommandOptions {
  const built: BuildFocusCommandOptions = {};
  if (options.focusOrigin !== undefined) {
    built.origin = options.focusOrigin;
  }
  return built;
}
