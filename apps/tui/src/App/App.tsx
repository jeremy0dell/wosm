import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import { Box, Text, useInput, useWindowSize } from "ink";
import { type ReactNode, useEffect, useRef } from "react";
import { useStore } from "zustand/react";
import { CommandPrompt } from "../components/CommandPrompt/CommandPrompt.js";
import {
  Dashboard,
  DashboardHeader,
  type DashboardHeaderStatus,
} from "../components/Dashboard/Dashboard.js";
import { OverlayHost } from "../components/OverlayHost/OverlayHost.js";
import { ToastOverlay } from "../components/ToastOverlay/ToastOverlay.js";
import { TuiFrame } from "../components/TuiFrame/TuiFrame.js";
import { TuiShell } from "../components/TuiShell/TuiShell.js";
import type { TuiObserverService } from "../services/types.js";
import { normalizeTuiKey } from "../state/keys.js";
import { activeTuiToast, nextTuiToastExpiry } from "../state/toasts.js";
import type { TuiObserverConnectionStatus, TuiScreen } from "../state/types.js";
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
  const quitActionLabel = persistentPopup && onDismiss !== undefined ? "close" : "quit";
  const quitHint = quitActionLabel === "close" ? "Q/esc:close" : "Q:quit";
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
  const activeToast = useStore(store, activeTuiToast);
  const nextExpiry = useStore(store, nextTuiToastExpiry);
  const observerConnectionStatus = useStore(store, (state) => state.observerConnectionStatus);
  const topRowWidgets = useTopRowWidgets(tuiConfig?.widgets ?? EMPTY_WIDGETS, topRowWidgetDeps);
  const observerStatus = observerHeaderStatusForConnection(
    observerConnectionStatus,
    snapshot !== undefined,
  );
  const toastHiddenByModal = isModalOverlayActive(screen);
  const wasToastHiddenByModal = useRef(toastHiddenByModal);

  useEffect(() => store.getState().start(), [store]);
  useEffect(() => {
    const wasHidden = wasToastHiddenByModal.current;
    wasToastHiddenByModal.current = toastHiddenByModal;
    if (wasHidden && !toastHiddenByModal && activeToast !== undefined) {
      store.getState().refreshActiveToastExpiry(Date.now());
    }
  }, [activeToast, store, toastHiddenByModal]);
  useEffect(() => {
    if (nextExpiry === undefined || toastHiddenByModal) {
      return;
    }
    const delay = Math.max(0, nextExpiry - Date.now());
    const timer = setTimeout(() => {
      store.getState().expireToasts(Date.now());
    }, delay);
    return () => clearTimeout(timer);
  }, [nextExpiry, store, toastHiddenByModal]);
  useEffect(() => {
    store.getState().setTerminalRows(rows);
  }, [rows, store]);

  useInput((input, key) => {
    if (parseSgrMouseScroll(input) !== undefined) {
      return;
    }
    store.getState().handleKey(normalizeTuiKey(input, key));
  });
  useMouseWheelInput(
    (direction) => {
      store.getState().handleKey({ input: "", mouseScroll: direction });
    },
    { enabled: !persistentPopup },
  );

  if (loading || snapshot === undefined) {
    return (
      <TuiFrame columns={columns} rows={rows}>
        <TuiShell>
          <Box flexDirection="column" flexGrow={1} height="100%" overflow="hidden" paddingRight={1}>
            <DashboardHeader
              productLabel={productLabel}
              columns={contentColumns}
              widgets={topRowWidgets}
            />
            <Text color="gray">{"─".repeat(contentColumns)}</Text>
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
              <SnapshotLoadingBody
                loading={loading}
                observerConnectionStatus={observerConnectionStatus}
              />
            </Box>
            <Text color="gray">{"─".repeat(contentColumns)}</Text>
            <Text color="gray">{quitHint}</Text>
          </Box>
          <ToastOverlay
            columns={columns}
            rows={rows}
            toast={activeToast}
            promptRows={0}
            hiddenByModal={toastHiddenByModal}
          />
        </TuiShell>
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
          quitActionLabel={quitActionLabel}
          {...(observerStatus === undefined ? {} : { observerStatus })}
        />
        <FixedStatusLayer>
          <CommandPrompt screen={screen} />
        </FixedStatusLayer>
        <ToastOverlay
          columns={columns}
          rows={rows}
          toast={activeToast}
          promptRows={commandPromptRows(screen)}
          hiddenByModal={toastHiddenByModal}
        />
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

function SnapshotLoadingBody({
  loading,
  observerConnectionStatus,
}: {
  loading: boolean;
  observerConnectionStatus: TuiObserverConnectionStatus;
}) {
  if (observerConnectionStatus.state === "reconnecting") {
    return (
      <>
        <Text> </Text>
        <Text>waiting for observer</Text>
        <Text color="gray">retrying connection</Text>
        <Text> </Text>
        <Text color="gray">The dashboard will appear when the observer is ready.</Text>
      </>
    );
  }

  if (!loading) {
    return (
      <>
        <Text> </Text>
        <Text>observer snapshot unavailable</Text>
        <Text color="gray">Check the error details and try refreshing when ready.</Text>
      </>
    );
  }

  return <Text color="gray">Loading observer snapshot...</Text>;
}

function observerHeaderStatusForConnection(
  status: TuiObserverConnectionStatus,
  hasSnapshot: boolean,
): DashboardHeaderStatus | undefined {
  if (hasSnapshot && status.state === "displayOnly") {
    return {
      full: "observer reconnecting · display-only snapshot",
      compact: "observer reconnecting",
    };
  }
  return undefined;
}

function commandPromptRows(screen: TuiScreen): number {
  if (screen.name === "search" || screen.name === "projectCollapse") {
    return 2;
  }
  if (screen.name === "removeWorktree") {
    return 2;
  }
  if (screen.name === "renameSession" && screen.step === "chooseSlot") {
    return 2;
  }
  return 0;
}

function isModalOverlayActive(screen: TuiScreen): boolean {
  return (
    screen.name === "help" ||
    screen.name === "newSession" ||
    (screen.name === "renameSession" && screen.step === "editName")
  );
}
