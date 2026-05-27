import { Box } from "ink";
import type { TuiOverlayState } from "../../uiState.js";
import { HelpOverlay } from "../HelpOverlay/HelpOverlay.js";

export type OverlayLayerProps = {
  activeOverlay: TuiOverlayState | undefined;
  columns: number;
  rows: number;
};

export function OverlayLayer({ activeOverlay, columns, rows }: OverlayLayerProps) {
  if (activeOverlay === undefined) {
    return null;
  }

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width={Math.max(1, columns)}
      height={Math.max(1, rows)}
      overflow="hidden"
    >
      {activeOverlay === "help" ? <HelpOverlay columns={columns} rows={rows} /> : null}
    </Box>
  );
}
