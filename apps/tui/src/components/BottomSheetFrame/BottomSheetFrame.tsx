import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { FloatingBlankBackground } from "../FloatingBlankBackground/FloatingBlankBackground.js";
import { bottomSheetContentWidth, bottomSheetFrameLayout } from "./layout.js";

export type BottomSheetFrameProps = {
  columns: number;
  rows: number;
  title: string;
  contentRows: number;
  minHeight?: number;
  children: ReactNode;
};

export function BottomSheetFrame({
  columns,
  rows,
  title,
  contentRows,
  minHeight = 7,
  children,
}: BottomSheetFrameProps) {
  const layout = bottomSheetFrameLayout({ columns, rows, contentRows, minHeight });
  return (
    <>
      <FloatingBlankBackground
        left={layout.left}
        top={layout.top}
        width={layout.width}
        height={layout.height}
      />
      <Box
        position="absolute"
        left={layout.left}
        top={layout.top}
        width={layout.width}
        height={layout.height}
        borderStyle="round"
        borderColor="gray"
        flexDirection="column"
        overflow="hidden"
      >
        <Text bold>{` ${title}`}</Text>
        <Box
          flexDirection="column"
          width={bottomSheetContentWidth(columns)}
          height={Math.max(0, layout.height - 3)}
          overflow="hidden"
          flexShrink={1}
        >
          <Box flexDirection="column" flexShrink={0}>
            {children}
          </Box>
        </Box>
      </Box>
    </>
  );
}
