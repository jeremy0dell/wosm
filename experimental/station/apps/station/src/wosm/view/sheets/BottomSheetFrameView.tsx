// OpenTUI port of apps/tui's BottomSheetFrame: an absolute-positioned,
// bordered sheet over the lower dashboard, sized by the shared frame layout.
// The box paints its own background (no blank-background hack) and absorbs
// mouse input as the sheet backdrop.
import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import {
  bottomSheetContentWidth,
  bottomSheetFrameLayout,
} from "@wosm/dashboard-core";
import { WOSM_COLORS } from "../theme.js";
import { useWosmMouse, wosmMouseProps } from "../wosmMouseContext.js";

export type BottomSheetFrameViewProps = {
  columns: number;
  rows: number;
  title: string;
  contentRows: number;
  minHeight?: number;
  children: ReactNode;
};

export function BottomSheetFrameView({
  columns,
  rows,
  title,
  contentRows,
  minHeight = 7,
  children,
}: BottomSheetFrameViewProps) {
  const dispatch = useWosmMouse();
  const layout = bottomSheetFrameLayout({ columns, rows, contentRows, minHeight });
  return (
    <box
      position="absolute"
      left={layout.left}
      top={layout.top}
      width={layout.width}
      height={layout.height}
      zIndex={10}
      border
      borderColor={WOSM_COLORS.gray}
      backgroundColor={WOSM_COLORS.background}
      flexDirection="column"
      {...wosmMouseProps(dispatch, { kind: "sheetBackdrop" })}
    >
      <text fg={WOSM_COLORS.foreground} attributes={TextAttributes.BOLD}>{` ${title}`}</text>
      <box
        flexDirection="column"
        width={bottomSheetContentWidth(columns)}
        height={Math.max(0, layout.height - 3)}
      >
        {children}
      </box>
    </box>
  );
}
