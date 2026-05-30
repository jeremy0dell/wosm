import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import { Box, Text, useWindowSize } from "ink";
import { CommandPrompt } from "../components/CommandPrompt/CommandPrompt.js";
import { Dashboard } from "../components/Dashboard/Dashboard.js";
import { OverlayHost } from "../components/OverlayHost/OverlayHost.js";
import { ToastStack } from "../components/ToastStack/ToastStack.js";
import { TuiFrame } from "../components/TuiFrame/TuiFrame.js";
import { TuiShell } from "../components/TuiShell/TuiShell.js";
import { useDashboardInput } from "../hooks/useDashboardInput.js";
import { useObserverDashboard } from "../hooks/useObserverDashboard.js";
import type { TuiObserverService } from "../services/types.js";
import { createInitialUiState, type TuiUiState } from "../uiState/uiState.js";

export type AppProps = {
  service: TuiObserverService;
  initialSnapshot?: WosmSnapshot;
  initialUiState?: TuiUiState;
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
  initialUiState,
  exitOnFocusSuccess = false,
  focusOrigin,
  resolveFocusOrigin,
  onFocusSuccess,
  onDismiss,
  persistentPopup = false,
  onExit,
}: AppProps) {
  const { columns, rows } = useWindowSize();
  const dashboard = useObserverDashboard({
    service,
    ...(initialSnapshot === undefined ? {} : { initialSnapshot }),
    initialUiState: initialUiState ?? createInitialUiState(),
  });
  const inputState = useDashboardInput({
    dashboard,
    snapshot: dashboard.snapshot,
    exitOnFocusSuccess,
    focusOrigin,
    resolveFocusOrigin,
    onFocusSuccess,
    onDismiss,
    persistentPopup,
    onExit,
  });

  if (dashboard.loading || dashboard.snapshot === undefined) {
    return (
      <TuiFrame columns={columns} rows={rows}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <Text>wosm</Text>
          <Text color="gray">Loading observer snapshot...</Text>
          <ToastStack toasts={dashboard.toasts} />
        </Box>
      </TuiFrame>
    );
  }

  return (
    <TuiFrame columns={columns} rows={rows}>
      <TuiShell>
        <Dashboard
          columns={columns}
          snapshot={dashboard.snapshot}
          uiState={dashboard.uiState}
          quitActionLabel={persistentPopup && onDismiss !== undefined ? "close" : "quit"}
        >
          <CommandPrompt prompt={dashboard.uiState.prompt} />
          <ToastStack toasts={dashboard.toasts} />
        </Dashboard>
        <OverlayHost columns={columns} overlay={inputState.overlay} rows={rows} />
      </TuiShell>
    </TuiFrame>
  );
}
