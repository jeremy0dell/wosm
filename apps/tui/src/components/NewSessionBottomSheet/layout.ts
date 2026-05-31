import type { NewSessionFlowState } from "../../flows/newSession.js";
import { SELECTION_KEYS } from "../../selectors/selectors.js";

export const MAX_PICKER_OPTIONS = SELECTION_KEYS.length;

export type NewSessionBottomSheetLayoutInput = {
  columns: number;
  rows: number;
  state: NewSessionFlowState;
  optionCount: number;
};

export type NewSessionBottomSheetLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function newSessionBottomSheetLayout(
  input: NewSessionBottomSheetLayoutInput,
): NewSessionBottomSheetLayout {
  const width = Math.max(1, input.columns);
  const viewportRows = Math.max(1, input.rows);
  const contentRows = contentRowCount(input.state, input.optionCount);
  const height = Math.min(viewportRows, Math.max(7, contentRows + 2));
  return {
    left: 0,
    top: Math.max(0, viewportRows - height),
    width,
    height,
  };
}

function contentRowCount(state: NewSessionFlowState, optionCount: number): number {
  if (state.mode === "pickProject" || state.mode === "pickAgent") {
    return Math.min(optionCount, MAX_PICKER_OPTIONS) + 4;
  }
  return 8;
}
