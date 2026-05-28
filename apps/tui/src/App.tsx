import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import { Box, Text, useWindowSize } from "ink";
import { NewSessionFlowProvider } from "./components/NewSessionFlowProvider/NewSessionFlowProvider.js";
import { ToastStack } from "./components/ToastStack.js";
import { TuiFrame } from "./components/TuiFrame.js";
import { TuiInteractionProvider } from "./components/TuiInteractionProvider/TuiInteractionProvider.js";
import { useObserverDashboard } from "./hooks/useObserverDashboard.js";
import type { TuiObserverService } from "./services/types.js";
import { createInitialUiState, type TuiUiState } from "./uiState.js";

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
      <NewSessionFlowProvider dashboard={dashboard} snapshot={dashboard.snapshot}>
        <TuiInteractionProvider
          columns={columns}
          dashboard={dashboard}
          exitOnFocusSuccess={exitOnFocusSuccess}
          focusOrigin={focusOrigin}
          onDismiss={onDismiss}
          onExit={onExit}
          onFocusSuccess={onFocusSuccess}
          persistentPopup={persistentPopup}
          resolveFocusOrigin={resolveFocusOrigin}
          rows={rows}
          snapshot={dashboard.snapshot}
        />
      </NewSessionFlowProvider>
    </TuiFrame>
  );
}
