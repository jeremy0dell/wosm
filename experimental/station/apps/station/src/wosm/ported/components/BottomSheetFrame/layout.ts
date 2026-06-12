// ADAPTED-EXTRACTION from
// apps/tui/src/components/BottomSheetFrame/BottomSheetFrame.tsx (see
// ../../PROVENANCE.md): the pure frame layout, verbatim bodies; the Ink
// component around them is rewritten in src/wosm/view/sheets/.
export type BottomSheetFrameLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function bottomSheetFrameLayout(input: {
  columns: number;
  rows: number;
  contentRows: number;
  minHeight?: number;
}): BottomSheetFrameLayout {
  const width = Math.max(1, input.columns);
  const viewportRows = Math.max(1, input.rows);
  const minHeight = input.minHeight ?? 7;
  const height = Math.min(viewportRows, Math.max(minHeight, input.contentRows + 2));
  return {
    left: 0,
    top: Math.max(0, viewportRows - height),
    width,
    height,
  };
}

export function bottomSheetContentWidth(columns: number): number {
  return Math.max(1, Math.max(1, columns) - 2);
}

// From apps/tui/src/components/NewSessionBottomSheet/layout.ts (verbatim,
// minus the layout wrapper that only composed the two functions above).
import type { NewSessionFlowState } from "../../flows/newSession.js";
import { SELECTION_KEYS } from "../../selectors/selectors.js";

export const MAX_PICKER_OPTIONS = SELECTION_KEYS.length;

export function newSessionContentRowCount(state: NewSessionFlowState, optionCount: number): number {
  if (state.mode === "pickProject" || state.mode === "pickAgent") {
    return Math.min(optionCount, MAX_PICKER_OPTIONS) + 4;
  }
  if (state.mode === "editName") {
    return 6;
  }
  return 7;
}
