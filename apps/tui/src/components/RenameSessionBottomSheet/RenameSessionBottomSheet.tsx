import type { TuiScreen } from "@wosm/dashboard-core";
import { bottomSheetContentWidth, truncateCells } from "@wosm/dashboard-core";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { BottomSheetFrame } from "../BottomSheetFrame/BottomSheetFrame.js";
import { EditableTextInput } from "../EditableTextInput/EditableTextInput.js";

export type RenameSessionBottomSheetProps = {
  state: Extract<TuiScreen, { name: "renameSession"; step: "editName" }>;
  columns: number;
  rows: number;
};

function LabelValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box>
      <Text>{` ${label.padEnd(10)}`}</Text>
      {value}
    </Box>
  );
}

function BlankLine() {
  return <Box height={1} />;
}

function FooterLine({ children, width }: { children: string; width: number }) {
  const text = ` ${children}`.padEnd(width).slice(0, width);
  return <Text>{text}</Text>;
}

function ValidationLine({ error, width }: { error: string | undefined; width: number }) {
  if (error === undefined) {
    return null;
  }
  return <Text color="red">{truncateCells(` ${error}`, width)}</Text>;
}

export function RenameSessionBottomSheet({ state, columns, rows }: RenameSessionBottomSheetProps) {
  const contentWidth = bottomSheetContentWidth(columns);
  return (
    <BottomSheetFrame
      columns={columns}
      rows={rows}
      title="Rename Session"
      contentRows={4}
      minHeight={7}
    >
      {state.validationError === undefined ? <BlankLine /> : null}
      <LabelValue label="Name" value={<EditableTextInput {...state.draftTitle} />} />
      <ValidationLine error={state.validationError} width={contentWidth} />
      <FooterLine width={contentWidth}>{"Enter:rename   Esc:back"}</FooterLine>
    </BottomSheetFrame>
  );
}
