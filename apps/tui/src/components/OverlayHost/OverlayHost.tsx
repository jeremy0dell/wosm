import type { WosmSnapshot } from "@wosm/contracts";
import { Box } from "ink";
import type { TuiScreen } from "../../state/screen.js";
import { HelpOverlay } from "../HelpOverlay/HelpOverlay.js";
import { NewSessionBottomSheet } from "../NewSessionBottomSheet/NewSessionBottomSheet.js";
import { RenameSessionBottomSheet } from "../RenameSessionBottomSheet/RenameSessionBottomSheet.js";

export type OverlayHostProps = {
  snapshot: WosmSnapshot;
  screen: TuiScreen;
  columns: number;
  rows: number;
};

export function OverlayHost({ snapshot, screen, columns, rows }: OverlayHostProps) {
  if (
    screen.name !== "help" &&
    screen.name !== "newSession" &&
    !(screen.name === "renameSession" && screen.step === "editName")
  ) {
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
      {renderOverlay(snapshot, screen, columns, rows)}
    </Box>
  );
}

function renderOverlay(snapshot: WosmSnapshot, screen: TuiScreen, columns: number, rows: number) {
  if (screen.name === "help") {
    return <HelpOverlay columns={columns} rows={rows} />;
  }
  if (screen.name !== "newSession") {
    if (screen.name === "renameSession" && screen.step === "editName") {
      return <RenameSessionBottomSheet columns={columns} rows={rows} state={screen} />;
    }
    return null;
  }
  return (
    <NewSessionBottomSheet columns={columns} rows={rows} snapshot={snapshot} state={screen.flow} />
  );
}
