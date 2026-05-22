import type { WosmSnapshot } from "@wosm/contracts";
import { Box, Text, useInput } from "ink";
import { useRef } from "react";
import { buildCleanupCommand, buildCreateSessionCommand } from "./actions.js";
import { CommandPrompt } from "./components/CommandPrompt.js";
import { Dashboard } from "./components/Dashboard.js";
import { ToastStack } from "./components/ToastStack.js";
import { useObserverDashboard } from "./hooks/useObserverDashboard.js";
import { intentForDashboardKey } from "./keymap.js";
import { selectNewSessionAvailability } from "./selectors.js";
import { safeErrorToToast } from "./services/errors.js";
import type { TuiObserverService } from "./services/types.js";
import {
  closePrompt,
  createInitialUiState,
  openCleanupPrompt,
  openPrompt,
  type PromptMode,
  setSearchQuery,
  type TuiUiState,
  updatePromptValue,
} from "./uiState.js";

export type AppProps = {
  service: TuiObserverService;
  initialSnapshot?: WosmSnapshot;
  initialUiState?: TuiUiState;
  onExit?: (code: number) => void;
};

export function App({ service, initialSnapshot, initialUiState, onExit }: AppProps) {
  const promptValueRef = useRef("");
  const promptModeRef = useRef<PromptMode | undefined>(undefined);
  const dashboard = useObserverDashboard({
    service,
    ...(initialSnapshot === undefined ? {} : { initialSnapshot }),
    initialUiState: initialUiState ?? createInitialUiState(),
  });

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onExit?.(0);
      return;
    }
    if (dashboard.uiState.prompt !== undefined || promptModeRef.current !== undefined) {
      handlePromptInput({ input, key, dashboard, promptValueRef, promptModeRef });
      return;
    }
    if (input === "q") {
      onExit?.(0);
      return;
    }
    if (input === "/") {
      promptValueRef.current = "";
      promptModeRef.current = "search";
      dashboard.setUiState((current) => openPrompt(current, "search"));
      return;
    }
    if (input === "r") {
      void dashboard.reconcile("tui-refresh");
      return;
    }
    if (dashboard.snapshot === undefined) {
      return;
    }
    const intent = intentForDashboardKey(input, dashboard.snapshot, dashboard.uiState);
    if (intent.type === "open-new-session-prompt") {
      const availability = selectNewSessionAvailability(dashboard.snapshot, dashboard.uiState);
      if (!availability.available) {
        dashboard.addToast(safeErrorToToast(availability.error));
        return;
      }
      promptValueRef.current = "";
      promptModeRef.current = "new-session";
      dashboard.setUiState((current) => openPrompt(current, "new-session"));
      return;
    }
    if (intent.type === "open-cleanup-prompt") {
      promptValueRef.current = "";
      promptModeRef.current = "confirm-cleanup";
      dashboard.setUiState((current) =>
        openCleanupPrompt(current, {
          action: intent.action,
          rowId: intent.rowId,
          forceRequired: intent.forceRequired,
          label: intent.label,
        }),
      );
      return;
    }
    if (intent.type === "command") {
      void dashboard.dispatchCommand(intent.command);
    }
  });

  if (dashboard.loading || dashboard.snapshot === undefined) {
    return (
      <Box flexDirection="column">
        <Text>wosm</Text>
        <Text color="gray">Loading observer snapshot...</Text>
        <ToastStack toasts={dashboard.toasts} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Dashboard snapshot={dashboard.snapshot} uiState={dashboard.uiState} />
      <CommandPrompt prompt={dashboard.uiState.prompt} />
      <ToastStack toasts={dashboard.toasts} />
    </Box>
  );
}

type PromptInputContext = {
  input: string;
  key: {
    return?: boolean;
    escape?: boolean;
    backspace?: boolean;
    delete?: boolean;
  };
  dashboard: ReturnType<typeof useObserverDashboard>;
  promptValueRef: { current: string };
  promptModeRef: { current: PromptMode | undefined };
};

function handlePromptInput({
  input,
  key,
  dashboard,
  promptValueRef,
  promptModeRef,
}: PromptInputContext): void {
  const mode = dashboard.uiState.prompt?.mode ?? promptModeRef.current;
  if (mode === undefined) {
    return;
  }
  if (key.escape === true) {
    promptValueRef.current = "";
    promptModeRef.current = undefined;
    dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  if (key.backspace === true || key.delete === true) {
    promptValueRef.current = promptValueRef.current.slice(0, -1);
    dashboard.setUiState((current) => updatePromptValue(current, promptValueRef.current));
    return;
  }
  if (key.return === true || input === "\r" || input === "\n") {
    if (mode === "search") {
      dashboard.setUiState((current) =>
        closePrompt(setSearchQuery(current, promptValueRef.current)),
      );
      promptValueRef.current = "";
      promptModeRef.current = undefined;
      return;
    }
    if (mode === "confirm-cleanup") {
      submitCleanupPrompt(dashboard);
      promptValueRef.current = "";
      promptModeRef.current = undefined;
      return;
    }
    submitNewSessionPrompt(dashboard, promptValueRef.current.trim());
    promptValueRef.current = "";
    promptModeRef.current = undefined;
    return;
  }
  if (mode === "confirm-cleanup") {
    return;
  }
  if (input.length > 0) {
    promptValueRef.current = `${promptValueRef.current}${input}`;
    dashboard.setUiState((current) => updatePromptValue(current, promptValueRef.current));
  }
}

function submitCleanupPrompt(dashboard: ReturnType<typeof useObserverDashboard>): void {
  const prompt = dashboard.uiState.prompt;
  if (prompt?.mode !== "confirm-cleanup" || dashboard.snapshot === undefined) {
    dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  const row = dashboard.snapshot.rows.find((candidate) => candidate.id === prompt.rowId);
  if (row === undefined) {
    dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  void dashboard.dispatchCommand(buildCleanupCommand(row, prompt.action, prompt.forceRequired));
  dashboard.setUiState((current) => closePrompt(current));
}

function submitNewSessionPrompt(
  dashboard: ReturnType<typeof useObserverDashboard>,
  branch: string,
): void {
  if (branch.length === 0 || dashboard.snapshot === undefined) {
    dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  const availability = selectNewSessionAvailability(dashboard.snapshot, dashboard.uiState);
  if (!availability.available) {
    dashboard.addToast(safeErrorToToast(availability.error));
    dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  void dashboard.dispatchCommand(
    buildCreateSessionCommand({ project: availability.project, branch }),
  );
  dashboard.setUiState((current) => closePrompt(current));
}
