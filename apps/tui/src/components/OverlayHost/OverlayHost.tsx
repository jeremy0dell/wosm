import type { WosmSnapshot } from "@wosm/contracts";
import { Box } from "ink";
import type { NewSessionFlowState } from "../../flows/newSession.js";
import { HelpOverlay } from "../HelpOverlay/HelpOverlay.js";
import { NewSessionBottomSheet } from "../NewSessionBottomSheet/NewSessionBottomSheet.js";

export type OverlayHostProps = {
  overlay: OverlayHostState | undefined;
  columns: number;
  rows: number;
};

export type OverlayHostState =
  | {
      type: "help";
    }
  | {
      type: "new-session";
      snapshot: WosmSnapshot;
      state: NewSessionFlowState;
    };

export function OverlayHost({ overlay, columns, rows }: OverlayHostProps) {
  if (overlay === undefined) {
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
      {renderOverlay(overlay, columns, rows)}
    </Box>
  );
}

function renderOverlay(overlay: OverlayHostState, columns: number, rows: number) {
  if (overlay.type === "help") {
    return <HelpOverlay columns={columns} rows={rows} />;
  }
  return (
    <NewSessionBottomSheet
      columns={columns}
      rows={rows}
      snapshot={overlay.snapshot}
      state={overlay.state}
    />
  );
}
