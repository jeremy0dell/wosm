import { Box } from "ink";
import type { ReactNode } from "react";

export type TuiFrameProps = {
  children: ReactNode;
  columns: number;
  rows: number;
};

export function TuiFrame({ children, columns, rows }: TuiFrameProps) {
  return (
    <Box
      flexDirection="column"
      height={Math.max(1, rows)}
      overflow="hidden"
      width={Math.max(1, columns)}
    >
      {children}
    </Box>
  );
}
