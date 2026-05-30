import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import { Box, Text, useInput, useWindowSize } from "ink";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand/react";
import { CommandPrompt } from "../components/CommandPrompt/CommandPrompt.js";
import { Dashboard } from "../components/Dashboard/Dashboard.js";
import { OverlayHost } from "../components/OverlayHost/OverlayHost.js";
import { ToastStack } from "../components/ToastStack/ToastStack.js";
import { TuiFrame } from "../components/TuiFrame/TuiFrame.js";
import { TuiShell } from "../components/TuiShell/TuiShell.js";
import type { TuiObserverService } from "../services/types.js";
import { normalizeTuiKey } from "../state/keys.js";
import { createTuiStore } from "../state/store.js";

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
  const store = useMemo(
    () =>
      createTuiStore({
        service,
        ...(initialSnapshot === undefined ? {} : { initialSnapshot }),
        exitOnFocusSuccess,
        ...(focusOrigin === undefined ? {} : { focusOrigin }),
        ...(resolveFocusOrigin === undefined ? {} : { resolveFocusOrigin }),
        ...(onFocusSuccess === undefined ? {} : { onFocusSuccess }),
        ...(onDismiss === undefined ? {} : { onDismiss }),
        persistentPopup,
        ...(onExit === undefined ? {} : { onExit }),
      }),
    [
      exitOnFocusSuccess,
      focusOrigin,
      initialSnapshot,
      onDismiss,
      onExit,
      onFocusSuccess,
      persistentPopup,
      resolveFocusOrigin,
      service,
    ],
  );
  const snapshot = useStore(store, (state) => state.snapshot);
  const loading = useStore(store, (state) => state.loading);
  const screen = useStore(store, (state) => state.screen);
  const searchQuery = useStore(store, (state) => state.searchQuery);
  const collapsedProjectIds = useStore(store, (state) => state.collapsedProjectIds);
  const toasts = useStore(store, (state) => state.toasts);

  useEffect(() => store.getState().start(), [store]);

  useInput((input, key) => {
    store.getState().handleKey(normalizeTuiKey(input, key));
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
          viewState={{ searchQuery, collapsedProjectIds }}
          quitActionLabel={persistentPopup && onDismiss !== undefined ? "close" : "quit"}
        >
          <CommandPrompt screen={screen} />
          <ToastStack toasts={toasts} />
        </Dashboard>
        <OverlayHost columns={columns} rows={rows} screen={screen} snapshot={snapshot} />
      </TuiShell>
    </TuiFrame>
  );
}
