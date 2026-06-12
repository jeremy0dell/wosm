import { useTerminalDimensions } from "@opentui/react";
import type { StationWosmStateSource } from "../sources/types.js";
import { getWosmViewStore } from "./store/wosmViewStore.js";
import { DashboardRoot } from "./view/DashboardRoot.js";

/**
 * WOSM mode: the full dashboard at parity with the apps/tui popup (ported
 * logic + OpenTUI render layer under ./), fed by the source boundary.
 * View state lives in a module-level store so collapse/search/scroll survive
 * toggling the overlay; the overlay occupies everything under Station's
 * one-row header.
 */
export function WosmOverlay({ source }: { source: StationWosmStateSource }) {
  const store = getWosmViewStore(source);
  const { width, height } = useTerminalDimensions();
  return (
    <box width="100%" flexGrow={1} flexDirection="column">
      <DashboardRoot store={store} columns={width} rows={Math.max(1, height - 1)} />
    </box>
  );
}
