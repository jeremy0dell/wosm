import { randomInt } from "node:crypto";
import type { TerminalFocusOrigin, WosmCommand, WosmSnapshot } from "@wosm/contracts";
import { useInput } from "ink";
import { useRef, useState } from "react";
import {
  buildCleanupCommand,
  buildCreateSessionCommand,
  cleanupForceRequired,
} from "../actions.js";
import type { OverlayHostState } from "../components/OverlayHost/OverlayHost.js";
import {
  createNewSessionFlow,
  type NewSessionFlowState,
  newSessionIntentForInput,
  transitionNewSessionFlow,
  validateNewSessionCreate,
} from "../flows/newSession.js";
import { intentForDashboardKey } from "../keymap.js";
import { selectKeySlots } from "../selectors.js";
import { safeErrorToToast, toSafeError } from "../services/errors.js";
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
} from "../uiState.js";
import type { ObserverDashboardState } from "./useObserverDashboard.js";

export type UseDashboardInputOptions = {
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot | undefined;
  exitOnFocusSuccess: boolean;
  focusOrigin: TerminalFocusOrigin | undefined;
  resolveFocusOrigin: (() => Promise<TerminalFocusOrigin | undefined>) | undefined;
  onFocusSuccess: (() => Promise<void>) | undefined;
  onDismiss: (() => Promise<void>) | undefined;
  persistentPopup: boolean;
  onExit: ((code: number) => void) | undefined;
};

export type DashboardInputState = {
  overlay: OverlayHostState | undefined;
};

type InputKey = {
  ctrl?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
};

export function useDashboardInput(options: UseDashboardInputOptions): DashboardInputState {
  const promptValueRef = useRef("");
  const promptModeRef = useRef<PromptMode | undefined>(undefined);
  const newSessionStateRef = useRef<NewSessionFlowState | undefined>(undefined);
  const [newSessionState, setRenderedNewSessionState] = useState<NewSessionFlowState | undefined>();
  const setNewSessionState = (next: NewSessionFlowState | undefined) => {
    newSessionStateRef.current = next;
    setRenderedNewSessionState(next);
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      options.onExit?.(0);
      return;
    }

    const activeNewSession = newSessionStateRef.current;
    if (activeNewSession !== undefined) {
      if (options.snapshot === undefined) {
        setNewSessionState(undefined);
        return;
      }
      handleNewSessionInput({
        input,
        key,
        dashboard: options.dashboard,
        snapshot: options.snapshot,
        state: activeNewSession,
        setNewSessionState,
      });
      return;
    }

    if (options.dashboard.uiState.prompt !== undefined || promptModeRef.current !== undefined) {
      handlePromptInput({
        input,
        key,
        dashboard: options.dashboard,
        snapshot: options.snapshot,
        promptValueRef,
        promptModeRef,
      });
      return;
    }

    if (options.dashboard.uiState.activeOverlay === "help") {
      if (input === "H" || input === "?" || input === "Q" || key.escape === true) {
        options.dashboard.setUiState((current) => closeOverlay(current));
      }
      return;
    }

    if (input === "H" || input === "?") {
      options.dashboard.setUiState((current) => openHelpOverlay(current));
      return;
    }

    if (
      options.persistentPopup &&
      options.onDismiss !== undefined &&
      (input === "q" || input === "Q" || key.escape === true)
    ) {
      void dismissPersistentPopup(options.onDismiss, options.dashboard);
      return;
    }

    if (input === "q" || input === "Q") {
      options.onExit?.(0);
      return;
    }

    if (input === "/") {
      promptValueRef.current = "";
      promptModeRef.current = "search";
      options.dashboard.setUiState((current) => openPrompt(current, "search"));
      return;
    }

    if (input === "r" || input === "R") {
      void options.dashboard.reconcile("tui-refresh");
      return;
    }

    if (input === "x" || input === "X") {
      promptValueRef.current = "";
      promptModeRef.current = "remove-slot";
      options.dashboard.setUiState((current) => openPrompt(current, "remove-slot"));
      return;
    }

    if (options.snapshot === undefined) {
      return;
    }

    const dashboardKey = key.return === true || input === "\r" || input === "\n" ? "enter" : input;
    const intent = intentForDashboardKey(
      dashboardKey,
      options.snapshot,
      options.dashboard.uiState,
      dashboardKeyOptions(options.focusOrigin),
    );

    if (intent.type === "open-new-session-prompt") {
      openNewSessionFlow({
        dashboard: options.dashboard,
        snapshot: options.snapshot,
        setNewSessionState,
      });
      return;
    }

    if (intent.type === "open-cleanup-prompt") {
      promptValueRef.current = "";
      promptModeRef.current = "confirm-cleanup";
      options.dashboard.setUiState((current) =>
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
          exitOnFocusSuccess: options.exitOnFocusSuccess,
          persistentPopup: options.persistentPopup,
          ...(options.resolveFocusOrigin === undefined
            ? {}
            : { resolveFocusOrigin: options.resolveFocusOrigin }),
          ...(options.onFocusSuccess === undefined
            ? {}
            : { onFocusSuccess: options.onFocusSuccess }),
        })
      ) {
        void dispatchFocusWithLifecycle(
          intent.command,
          options.dashboard,
          buildFocusLifecycleOptions({
            exitOnFocusSuccess: options.exitOnFocusSuccess,
            focusOrigin: options.focusOrigin,
            resolveFocusOrigin: options.resolveFocusOrigin,
            onFocusSuccess: options.onFocusSuccess,
            persistentPopup: options.persistentPopup,
            onExit: options.onExit,
          }),
        );
        return;
      }
      void options.dashboard.dispatchCommand(intent.command);
    }
  });

  return {
    overlay: overlayRenderState(options.snapshot, options.dashboard.uiState, newSessionState),
  };
}

function openNewSessionFlow(input: {
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot;
  setNewSessionState(next: NewSessionFlowState | undefined): void;
}): void {
  const state = createNewSessionFlow(input.snapshot, createSessionNameToken());
  if (state === undefined) {
    input.dashboard.addToast(
      safeErrorToToast({
        tag: "CommandValidationError",
        code: "PROJECT_NOT_CONFIGURED",
        message: "No project is configured for a new session.",
        hint: "Add a project to config.toml and run wosm reconcile.",
      }),
    );
    return;
  }
  input.setNewSessionState(state);
}

function handleNewSessionInput(input: {
  input: string;
  key: InputKey;
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot;
  state: NewSessionFlowState;
  setNewSessionState(next: NewSessionFlowState | undefined): void;
}): void {
  const intent = newSessionIntentForInput(input.state, {
    input: input.input,
    key: input.key,
    token: createSessionNameToken(),
  });

  if (intent.type === "none") {
    return;
  }

  if (intent.type === "submit") {
    submitNewSessionFlow({
      dashboard: input.dashboard,
      snapshot: input.snapshot,
      state: input.state,
      setNewSessionState: input.setNewSessionState,
    });
    return;
  }

  input.setNewSessionState(transitionNewSessionFlow(input.state, input.snapshot, intent.action));
}

function submitNewSessionFlow(input: {
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot;
  state: NewSessionFlowState;
  setNewSessionState(next: NewSessionFlowState | undefined): void;
}): void {
  const validation = validateNewSessionCreate(input.snapshot, input.state);
  input.setNewSessionState(undefined);
  if (!validation.ok) {
    input.dashboard.addToast(safeErrorToToast(validation.error));
    return;
  }

  const branch = validation.branch.trim();
  void input.dashboard.dispatchCommand(
    buildCreateSessionCommand({
      project: validation.project,
      branch,
      harnessProvider: validation.harnessProvider,
    }),
  );
}

function overlayRenderState(
  snapshot: WosmSnapshot | undefined,
  uiState: TuiUiState,
  newSessionState: NewSessionFlowState | undefined,
): OverlayHostState | undefined {
  if (uiState.activeOverlay === "help") {
    return { type: "help" };
  }
  if (snapshot !== undefined && newSessionState !== undefined) {
    return {
      type: "new-session",
      snapshot,
      state: newSessionState,
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
  key: InputKey;
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot | undefined;
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
    dashboard.setUiState((current) => closePrompt(setSearchQuery(current, promptValueRef.current)));
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
  snapshot: WosmSnapshot | undefined;
  slot: string;
  promptValueRef: { current: string };
  promptModeRef: { current: PromptMode | undefined };
}): void {
  if (input.snapshot === undefined) {
    input.promptValueRef.current = "";
    input.promptModeRef.current = undefined;
    input.dashboard.setUiState((current) => closePrompt(current));
    return;
  }

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

function submitCleanupPrompt(
  dashboard: ObserverDashboardState,
  snapshot: WosmSnapshot | undefined,
): void {
  const prompt = dashboard.uiState.prompt;
  if (prompt?.mode !== "confirm-cleanup" || snapshot === undefined) {
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

function createSessionNameToken(): string {
  return randomInt(36 ** 6)
    .toString(36)
    .padStart(6, "0");
}
