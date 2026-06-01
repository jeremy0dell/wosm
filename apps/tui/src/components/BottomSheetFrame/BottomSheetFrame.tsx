import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { FloatingBlankBackground } from "../FloatingBlankBackground/FloatingBlankBackground.js";

export type BottomSheetFrameProps = {
  columns: number;
  rows: number;
  title: string;
  contentRows: number;
  minHeight?: number;
  children: ReactNode;
};

export type BottomSheetFrameLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
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
