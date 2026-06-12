// Store-wired root for the WOSM dashboard: subscribes to the view store,
// feeds the overlay's row budget into the viewport math, and switches
// between the loading/waiting/unavailable bodies and the live dashboard —
// mirroring apps/tui's App.tsx branch for the popup posture.
import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import { useStore } from "zustand/react";
import {
  observerHeaderStatusForConnection,
  snapshotLoadingLines,
} from "../ported/components/Dashboard/content.js";
import type { TuiStore } from "../ported/state/store.js";
import { DashboardHeaderRow, DashboardView, Divider } from "./DashboardView.js";
import { WOSM_COLORS } from "./theme.js";

const QUIT_HINT = "Q/esc:close";

export type DashboardRootProps = {
  store: StoreApi<TuiStore>;
  /** The overlay's content area, in terminal cells. */
  columns: number;
  rows: number;
};

export function DashboardRoot({ store, columns, rows }: DashboardRootProps) {
  const snapshot = useStore(store, (state) => state.snapshot);
  const loading = useStore(store, (state) => state.loading);
  const searchQuery = useStore(store, (state) => state.searchQuery);
  const collapsedProjectIds = useStore(store, (state) => state.collapsedProjectIds);
  const scrollOffset = useStore(store, (state) => state.scrollOffset);
  const terminalRows = useStore(store, (state) => state.terminalRows);
  const localRows = useStore(store, (state) => state.localRows);
  const observerConnectionStatus = useStore(store, (state) => state.observerConnectionStatus);

  useEffect(() => {
    store.getState().setTerminalRows(rows);
  }, [rows, store]);

  const contentColumns = Math.max(1, Math.floor(columns) - 1);

  if (loading || snapshot === undefined) {
    return (
      <box width="100%" flexGrow={1} flexDirection="column" paddingRight={1}>
        <DashboardHeaderRow columns={contentColumns} widgets={[]} />
        <Divider columns={contentColumns} />
        <box flexDirection="column" flexGrow={1}>
          {snapshotLoadingLines(loading, observerConnectionStatus).map((line, index) => (
            <text
              key={`${index}:${line.text}`}
              fg={line.color === "gray" ? WOSM_COLORS.gray : WOSM_COLORS.foreground}
            >
              {line.text}
            </text>
          ))}
        </box>
        <Divider columns={contentColumns} />
        <text fg={WOSM_COLORS.gray}>{QUIT_HINT}</text>
      </box>
    );
  }

  const observerStatus = observerHeaderStatusForConnection(observerConnectionStatus, true);
  return (
    <DashboardView
      snapshot={snapshot}
      viewState={{ searchQuery, collapsedProjectIds, scrollOffset, terminalRows, localRows }}
      columns={columns}
      {...(observerStatus === undefined ? {} : { observerStatus })}
    />
  );
}
