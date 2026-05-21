import type { WosmSnapshot } from "@wosm/contracts";
import { Box, Text, useInput } from "ink";
import { useRef } from "react";
import { buildCreateSessionCommand, buildReconcileCommand } from "./actions.js";
import { CommandPrompt } from "./components/CommandPrompt.js";
import { Dashboard } from "./components/Dashboard.js";
import { ToastStack } from "./components/ToastStack.js";
import { useObserverDashboard } from "./hooks/useObserverDashboard.js";
import { intentForDashboardKey } from "./keymap.js";
import type { TuiObserverService } from "./services/types.js";
import {
  closePrompt,
  createInitialUiState,
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
      void dashboard.dispatchCommand(buildReconcileCommand("tui-refresh"));
      return;
    }
    if (dashboard.snapshot === undefined) {
      return;
    }
    const intent = intentForDashboardKey(input, dashboard.snapshot, dashboard.uiState);
    if (intent.type === "open-new-session-prompt") {
      promptValueRef.current = "";
      promptModeRef.current = "new-session";
      dashboard.setUiState((current) => openPrompt(current, "new-session"));
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
    submitNewSessionPrompt(dashboard, promptValueRef.current.trim());
    promptValueRef.current = "";
    promptModeRef.current = undefined;
    return;
  }
  if (input.length > 0) {
    promptValueRef.current = `${promptValueRef.current}${input}`;
    dashboard.setUiState((current) => updatePromptValue(current, promptValueRef.current));
  }
}

function submitNewSessionPrompt(
  dashboard: ReturnType<typeof useObserverDashboard>,
  branch: string,
): void {
  if (branch.length === 0 || dashboard.snapshot === undefined) {
    dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  const project = dashboard.snapshot.projects[0];
  if (project === undefined) {
    dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  void dashboard.dispatchCommand(buildCreateSessionCommand({ project, branch }));
  dashboard.setUiState((current) => closePrompt(current));
}
