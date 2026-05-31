import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import { Box, Text, useInput, useWindowSize } from "ink";
import { type ReactNode, useEffect } from "react";
import { useStore } from "zustand/react";
import { CommandPrompt } from "../components/CommandPrompt/CommandPrompt.js";
import { Dashboard } from "../components/Dashboard/Dashboard.js";
import { OverlayHost } from "../components/OverlayHost/OverlayHost.js";
import { ToastStack } from "../components/ToastStack/ToastStack.js";
import { TuiFrame } from "../components/TuiFrame/TuiFrame.js";
import { TuiShell } from "../components/TuiShell/TuiShell.js";
import type { TuiObserverService } from "../services/types.js";
import { normalizeTuiKey } from "../state/keys.js";
import { parseSgrMouseScroll, useMouseWheelInput } from "./useMouseWheelInput.js";
import { useTuiAppStore } from "./useTuiAppStore.js";

export type AppProps = {
  service: TuiObserverService;
  initialSnapshot?: WosmSnapshot;
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
  exitOnFocusSuccess = false,
  focusOrigin,
  resolveFocusOrigin,
  onFocusSuccess,
  onDismiss,
  persistentPopup = false,
  onExit,
}: AppProps) {
  const { columns, rows } = useWindowSize();
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
  const toasts = useStore(store, (state) => state.toasts);

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
          <Text>wosm</Text>
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
          viewState={{ searchQuery, collapsedProjectIds, scrollOffset, terminalRows }}
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
