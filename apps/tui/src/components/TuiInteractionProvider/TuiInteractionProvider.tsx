import type { TerminalFocusOrigin, WosmCommand, WosmSnapshot } from "@wosm/contracts";
import { useInput } from "ink";
import { useRef } from "react";
import { buildCleanupCommand, cleanupForceRequired } from "../../actions.js";
import type { ObserverDashboardState } from "../../hooks/useObserverDashboard.js";
import { intentForDashboardKey } from "../../keymap.js";
import { selectKeySlots } from "../../selectors.js";
import { safeErrorToToast, toSafeError } from "../../services/errors.js";
import {
  closeOverlay,
  closePrompt,
  openCleanupPrompt,
  openHelpOverlay,
  openPrompt,
  type PromptMode,
  setSearchQuery,
  type TuiUiState,
  updatePromptValue,
} from "../../uiState.js";
import { CommandPrompt } from "../CommandPrompt.js";
import { Dashboard } from "../Dashboard.js";
import {
  type NewSessionOverlayState,
  useNewSessionFlow,
} from "../NewSessionFlowProvider/NewSessionFlowProvider.js";
import { OverlayHost, type OverlayHostState } from "../OverlayHost/OverlayHost.js";
import { ToastStack } from "../ToastStack.js";
import { TuiShell } from "../TuiShell/TuiShell.js";

export type TuiInteractionProviderProps = {
  columns: number;
  rows: number;
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot;
  exitOnFocusSuccess: boolean;
  focusOrigin: TerminalFocusOrigin | undefined;
  resolveFocusOrigin: (() => Promise<TerminalFocusOrigin | undefined>) | undefined;
  onFocusSuccess: (() => Promise<void>) | undefined;
  onDismiss: (() => Promise<void>) | undefined;
  persistentPopup: boolean;
  onExit: ((code: number) => void) | undefined;
};

export function TuiInteractionProvider({
  columns,
  rows,
  dashboard,
  snapshot,
  exitOnFocusSuccess,
  focusOrigin,
  resolveFocusOrigin,
  onFocusSuccess,
  onDismiss,
  persistentPopup,
  onExit,
}: TuiInteractionProviderProps) {
  const promptValueRef = useRef("");
  const promptModeRef = useRef<PromptMode | undefined>(undefined);
  const newSession = useNewSessionFlow();

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onExit?.(0);
      return;
    }
    if (newSession.isActive) {
      return;
    }
    if (dashboard.uiState.prompt !== undefined || promptModeRef.current !== undefined) {
      handlePromptInput({ input, key, dashboard, snapshot, promptValueRef, promptModeRef });
      return;
    }
    if (dashboard.uiState.activeOverlay === "help") {
      if (input === "H" || input === "?" || input === "Q" || key.escape === true) {
        dashboard.setUiState((current) => closeOverlay(current));
      }
      return;
    }
    if (input === "H" || input === "?") {
      dashboard.setUiState((current) => openHelpOverlay(current));
      return;
    }
    if (
      persistentPopup &&
      onDismiss !== undefined &&
      (input === "q" || input === "Q" || key.escape === true)
    ) {
      void dismissPersistentPopup(onDismiss, dashboard);
      return;
    }
    if (input === "q" || input === "Q") {
      onExit?.(0);
      return;
    }
    if (input === "/") {
      promptValueRef.current = "";
      promptModeRef.current = "search";
      dashboard.setUiState((current) => openPrompt(current, "search"));
      return;
    }
    if (input === "r" || input === "R") {
      void dashboard.reconcile("tui-refresh");
      return;
    }
    if (input === "x" || input === "X") {
      promptValueRef.current = "";
      promptModeRef.current = "remove-slot";
      dashboard.setUiState((current) => openPrompt(current, "remove-slot"));
      return;
    }

    const dashboardKey = key.return === true || input === "\r" || input === "\n" ? "enter" : input;
    const intent = intentForDashboardKey(
      dashboardKey,
      snapshot,
      dashboard.uiState,
      dashboardKeyOptions(focusOrigin),
    );
    if (intent.type === "open-new-session-prompt") {
      newSession.open();
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
      if (
        shouldUseFocusLifecycle(intent.command, {
          exitOnFocusSuccess,
          persistentPopup,
          ...(resolveFocusOrigin === undefined ? {} : { resolveFocusOrigin }),
          ...(onFocusSuccess === undefined ? {} : { onFocusSuccess }),
        })
      ) {
        void dispatchFocusWithLifecycle(
          intent.command,
          dashboard,
          buildFocusLifecycleOptions({
            exitOnFocusSuccess,
            focusOrigin,
            resolveFocusOrigin,
            onFocusSuccess,
            persistentPopup,
            onExit,
          }),
        );
        return;
      }
      void dashboard.dispatchCommand(intent.command);
    }
  });

  return (
    <TuiShell>
      <Dashboard
        columns={columns}
        snapshot={snapshot}
        uiState={dashboard.uiState}
        optimisticCreates={newSession.optimisticCreates}
        quitActionLabel={persistentPopup && onDismiss !== undefined ? "close" : "quit"}
      >
        <CommandPrompt prompt={dashboard.uiState.prompt} />
        <ToastStack toasts={dashboard.toasts} />
      </Dashboard>
      <OverlayHost
        columns={columns}
        overlay={overlayRenderState(snapshot, dashboard.uiState, newSession.overlay)}
        rows={rows}
      />
    </TuiShell>
  );
}

function overlayRenderState(
  snapshot: WosmSnapshot,
  uiState: TuiUiState,
  newSession: NewSessionOverlayState,
): OverlayHostState | undefined {
  if (uiState.activeOverlay === "help") {
    return { type: "help" };
  }
  if (newSession !== undefined) {
    return {
      type: "new-session",
      snapshot,
      state: newSession.state,
    };
  }
  return undefined;
}

function dashboardKeyOptions(focusOrigin: TerminalFocusOrigin | undefined): {
  focusOrigin?: TerminalFocusOrigin;
} {
  const options: { focusOrigin?: TerminalFocusOrigin } = {};
  if (focusOrigin !== undefined) {
    options.focusOrigin = focusOrigin;
  }
  return options;
}

type FocusLifecyclePresence = {
  exitOnFocusSuccess: boolean;
  persistentPopup: boolean;
  resolveFocusOrigin?: () => Promise<TerminalFocusOrigin | undefined>;
  onFocusSuccess?: () => Promise<void>;
};

type FocusLifecycleOptions = FocusLifecyclePresence & {
  focusOrigin?: TerminalFocusOrigin;
  onExit?: (code: number) => void;
};

function shouldUseFocusLifecycle(
  command: WosmCommand,
  options: FocusLifecyclePresence,
): command is Extract<WosmCommand, { type: "terminal.focus" }> {
  return (
    command.type === "terminal.focus" &&
    (options.exitOnFocusSuccess ||
      options.persistentPopup ||
      options.resolveFocusOrigin !== undefined ||
      options.onFocusSuccess !== undefined)
  );
}

function buildFocusLifecycleOptions(options: {
  exitOnFocusSuccess: boolean;
  focusOrigin: TerminalFocusOrigin | undefined;
  resolveFocusOrigin: (() => Promise<TerminalFocusOrigin | undefined>) | undefined;
  onFocusSuccess: (() => Promise<void>) | undefined;
  persistentPopup: boolean;
  onExit: ((code: number) => void) | undefined;
}): FocusLifecycleOptions {
  const built: FocusLifecycleOptions = {
    exitOnFocusSuccess: options.exitOnFocusSuccess,
    persistentPopup: options.persistentPopup,
  };
  if (options.focusOrigin !== undefined) {
    built.focusOrigin = options.focusOrigin;
  }
  if (options.resolveFocusOrigin !== undefined) {
    built.resolveFocusOrigin = options.resolveFocusOrigin;
  }
  if (options.onFocusSuccess !== undefined) {
    built.onFocusSuccess = options.onFocusSuccess;
  }
  if (options.onExit !== undefined) {
    built.onExit = options.onExit;
  }
  return built;
}

async function dispatchFocusWithLifecycle(
  command: Extract<WosmCommand, { type: "terminal.focus" }>,
  dashboard: ObserverDashboardState,
  options: FocusLifecycleOptions,
): Promise<void> {
  let focusCommand: Extract<WosmCommand, { type: "terminal.focus" }>;
  try {
    focusCommand = await withResolvedFocusOrigin(command, options);
  } catch (error: unknown) {
    dashboard.addToast(safeErrorToToast(toSafeError(error)));
    return;
  }

  const waitsForCompletion =
    options.exitOnFocusSuccess || options.persistentPopup || options.onFocusSuccess !== undefined;
  if (!waitsForCompletion) {
    await dashboard.dispatchCommand(focusCommand);
    return;
  }

  const succeeded = await dashboard.dispatchCommandAndWaitForCompletion(focusCommand);
  if (!succeeded) {
    return;
  }

  if (options.onFocusSuccess !== undefined) {
    try {
      await options.onFocusSuccess();
    } catch (error: unknown) {
      dashboard.addToast(safeErrorToToast(toSafeError(error)));
    }
  }

  if (options.exitOnFocusSuccess && !options.persistentPopup) {
    options.onExit?.(0);
  }
}

async function dismissPersistentPopup(
  onDismiss: () => Promise<void>,
  dashboard: ObserverDashboardState,
): Promise<void> {
  try {
    await onDismiss();
  } catch (error: unknown) {
    dashboard.addToast(safeErrorToToast(toSafeError(error)));
  }
}

async function withResolvedFocusOrigin(
  command: Extract<WosmCommand, { type: "terminal.focus" }>,
  options: Pick<FocusLifecycleOptions, "focusOrigin" | "resolveFocusOrigin">,
): Promise<Extract<WosmCommand, { type: "terminal.focus" }>> {
  let origin = options.focusOrigin;
  if (options.resolveFocusOrigin !== undefined) {
    const resolved = await options.resolveFocusOrigin();
    if (resolved !== undefined) {
      origin = resolved;
    }
  }
  if (origin === undefined) {
    return command;
  }
  return {
    type: "terminal.focus",
    payload: {
      ...command.payload,
      origin,
    },
  };
}

type PromptInputContext = {
  input: string;
  key: {
    return?: boolean;
    escape?: boolean;
    backspace?: boolean;
    delete?: boolean;
  };
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot;
  promptValueRef: { current: string };
  promptModeRef: { current: PromptMode | undefined };
};

function handlePromptInput({
  input,
  key,
  dashboard,
  snapshot,
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
  if (mode === "remove-slot") {
    if (/^[1-9]$/.test(input)) {
      openRemoveConfirmationForSlot({
        dashboard,
        snapshot,
        slot: input,
        promptValueRef,
        promptModeRef,
      });
    }
    return;
  }
  if (mode === "confirm-cleanup") {
    if (input === "y" || input === "Y") {
      submitCleanupPrompt(dashboard, snapshot);
      promptValueRef.current = "";
      promptModeRef.current = undefined;
      return;
    }
    if (input === "n" || input === "N" || key.return === true || input === "\r" || input === "\n") {
      promptValueRef.current = "";
      promptModeRef.current = undefined;
      dashboard.setUiState((current) => closePrompt(current));
    }
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
    dashboard.setUiState((current) => closePrompt(current));
    promptValueRef.current = "";
    promptModeRef.current = undefined;
    return;
  }
  if (input.length > 0) {
    promptValueRef.current = `${promptValueRef.current}${input}`;
    dashboard.setUiState((current) => updatePromptValue(current, promptValueRef.current));
  }
}

function openRemoveConfirmationForSlot(input: {
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot;
  slot: string;
  promptValueRef: { current: string };
  promptModeRef: { current: PromptMode | undefined };
}): void {
  const row = selectKeySlots(input.snapshot, input.dashboard.uiState).get(input.slot);
  if (row === undefined) {
    return;
  }
  const action = "remove-worktree" as const;
  input.promptValueRef.current = "";
  input.promptModeRef.current = "confirm-cleanup";
  input.dashboard.setUiState((current) =>
    openCleanupPrompt(current, {
      action,
      rowId: row.id,
      forceRequired: cleanupForceRequired(row, action),
      label: `remove ${row.branch}? y/N`,
    }),
  );
}

function submitCleanupPrompt(dashboard: ObserverDashboardState, snapshot: WosmSnapshot): void {
  const prompt = dashboard.uiState.prompt;
  if (prompt?.mode !== "confirm-cleanup") {
    dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  const row = snapshot.rows.find((candidate) => candidate.id === prompt.rowId);
  if (row === undefined) {
    dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  void dashboard.dispatchCommand(buildCleanupCommand(row, prompt.action, prompt.forceRequired));
  dashboard.setUiState((current) => closePrompt(current));
}
