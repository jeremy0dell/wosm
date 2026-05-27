import { Box } from "ink";
import type { ReactNode } from "react";

export type TuiShellProps = {
  children: ReactNode;
};

export function TuiShell({ children }: TuiShellProps) {
  return (
    <Box position="relative" flexDirection="column" width="100%" height="100%" overflow="hidden">
      {children}
    </Box>
  );
}
