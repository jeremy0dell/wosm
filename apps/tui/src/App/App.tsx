import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import { Box, Text, useInput, useWindowSize } from "ink";
import { type ReactNode, useEffect } from "react";
import { useStore } from "zustand/react";
import { CommandPrompt } from "../components/CommandPrompt/CommandPrompt.js";
import { Dashboard, DashboardHeader } from "../components/Dashboard/Dashboard.js";
import { OverlayHost } from "../components/OverlayHost/OverlayHost.js";
import { ToastStack } from "../components/ToastStack/ToastStack.js";
import { TuiFrame } from "../components/TuiFrame/TuiFrame.js";
import { TuiShell } from "../components/TuiShell/TuiShell.js";
import type { TuiObserverService } from "../services/types.js";
import { normalizeTuiKey } from "../state/keys.js";
import { useTuiMode } from "../tuiMode.js";
import type { TopRowWidgetRuntimeDeps, TuiConfig, TuiWidgetConfig } from "../widgets/types.js";
import { useTopRowWidgets } from "../widgets/useTopRowWidgets.js";
import { parseSgrMouseScroll, useMouseWheelInput } from "./useMouseWheelInput.js";
import { useTuiAppStore } from "./useTuiAppStore.js";

const EMPTY_WIDGETS: readonly TuiWidgetConfig[] = [];

export type AppProps = {
  service: TuiObserverService;
  initialSnapshot?: WosmSnapshot;
  tuiConfig?: TuiConfig;
  topRowWidgetDeps?: TopRowWidgetRuntimeDeps;
  exitOnFocusSuccess?: boolean;
  focusOrigin?: TerminalFocusOrigin;
  resolveFocusOrigin?: () => Promise<TerminalFocusOrigin | undefined>;
  onFocusSuccess?: () => Promise<void>;
  onDismiss?: () => Promise<void>;
  persistentPopup?: boolean;
  onExit?: (code: number) => void;
};

export function App({
  service,
  initialSnapshot,
  tuiConfig,
  topRowWidgetDeps,
  exitOnFocusSuccess = false,
  focusOrigin,
  resolveFocusOrigin,
  onFocusSuccess,
  onDismiss,
  persistentPopup = false,
  onExit,
}: AppProps) {
  const { columns, rows } = useWindowSize();
  const mode = useTuiMode();
  const productLabel = mode === "dev" ? "wosm dev" : "wosm";
  const contentColumns = Math.max(1, columns - 1);
  const store = useTuiAppStore({
    service,
    initialSnapshot,
    exitOnFocusSuccess,
    focusOrigin,
    resolveFocusOrigin,
    onFocusSuccess,
    onDismiss,
    persistentPopup,
    onExit,
  });
  const snapshot = useStore(store, (state) => state.snapshot);
  const loading = useStore(store, (state) => state.loading);
  const screen = useStore(store, (state) => state.screen);
  const searchQuery = useStore(store, (state) => state.searchQuery);
  const collapsedProjectIds = useStore(store, (state) => state.collapsedProjectIds);
  const scrollOffset = useStore(store, (state) => state.scrollOffset);
  const terminalRows = useStore(store, (state) => state.terminalRows);
  const localRows = useStore(store, (state) => state.localRows);
  const toasts = useStore(store, (state) => state.toasts);
  const topRowWidgets = useTopRowWidgets(tuiConfig?.widgets ?? EMPTY_WIDGETS, topRowWidgetDeps);

  useEffect(() => store.getState().start(), [store]);
  useEffect(() => {
    store.getState().setTerminalRows(rows);
  }, [rows, store]);

  useInput((input, key) => {
    if (parseSgrMouseScroll(input) !== undefined) {
      return;
    }
    store.getState().handleKey(normalizeTuiKey(input, key));
  });
  useMouseWheelInput((direction) => {
    store.getState().handleKey({ input: "", mouseScroll: direction });
  });

  if (loading || snapshot === undefined) {
    return (
      <TuiFrame columns={columns} rows={rows}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <DashboardHeader
            productLabel={productLabel}
            columns={contentColumns}
            widgets={topRowWidgets}
          />
          <Text color="gray">Loading observer snapshot...</Text>
          <ToastStack toasts={toasts} />
        </Box>
      </TuiFrame>
    );
  }

  return (
    <TuiFrame columns={columns} rows={rows}>
      <TuiShell>
        <Dashboard
          columns={columns}
          snapshot={snapshot}
          screen={screen}
          viewState={{ searchQuery, collapsedProjectIds, scrollOffset, terminalRows, localRows }}
          topRowWidgets={topRowWidgets}
          quitActionLabel={persistentPopup && onDismiss !== undefined ? "close" : "quit"}
        />
        <FixedStatusLayer>
          <CommandPrompt screen={screen} />
          <ToastStack toasts={toasts} />
        </FixedStatusLayer>
        <OverlayHost columns={columns} rows={rows} screen={screen} snapshot={snapshot} />
      </TuiShell>
    </TuiFrame>
  );
}

function FixedStatusLayer({ children }: { children: ReactNode }) {
  return (
    <Box position="absolute" left={0} right={0} bottom={3} flexDirection="column" overflow="hidden">
      {children}
    </Box>
  );
}
