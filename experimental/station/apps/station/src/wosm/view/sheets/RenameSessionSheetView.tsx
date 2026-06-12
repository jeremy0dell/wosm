// OpenTUI port of apps/tui's RenameSessionBottomSheet.
import { bottomSheetContentWidth } from "../../ported/components/BottomSheetFrame/layout.js";
import { truncateCells } from "../../ported/components/WorktreeRow/layout.js";
import type { TuiScreen } from "../../ported/state/types.js";
import { EditableTextInputView } from "../EditableTextInputView.js";
import { WOSM_COLORS } from "../theme.js";
import { BottomSheetFrameView } from "./BottomSheetFrameView.js";
import { SheetFooter, SheetLabelValue, SheetLine } from "./parts.js";

export type RenameSessionSheetViewProps = {
  state: Extract<TuiScreen, { name: "renameSession"; step: "editName" }>;
  columns: number;
  rows: number;
};

export function RenameSessionSheetView({ state, columns, rows }: RenameSessionSheetViewProps) {
  const contentWidth = bottomSheetContentWidth(columns);
  return (
    <BottomSheetFrameView
      columns={columns}
      rows={rows}
      title="Rename Session"
      contentRows={4}
      minHeight={7}
    >
      {state.validationError === undefined ? <SheetLine width={contentWidth}> </SheetLine> : null}
      <SheetLabelValue
        width={contentWidth}
        label="Name"
        labelWidth={10}
        value={<EditableTextInputView {...state.draftTitle} />}
      />
      {state.validationError === undefined ? null : (
        <text fg={WOSM_COLORS.red}>{truncateCells(` ${state.validationError}`, contentWidth)}</text>
      )}
      <SheetFooter width={contentWidth}>{"Enter:rename   Esc:back"}</SheetFooter>
    </BottomSheetFrameView>
  );
}
