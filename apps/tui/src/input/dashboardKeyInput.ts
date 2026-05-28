import type { TerminalFocusOrigin } from "@wosm/contracts";
import { intentForDashboardKey } from "../keymap.js";
import { openCleanupPrompt, openHelpOverlay, openPrompt, type PromptMode } from "../uiState.js";
import {
  buildFocusLifecycleOptions,
  dismissPersistentPopup,
  dispatchFocusWithLifecycle,
  type FocusLifecyclePresence,
  shouldUseFocusLifecycle,
} from "./focusLifecycle.js";
import { isReturnInput } from "./keyEvents.js";
import { openNewSessionFlow } from "./newSessionInput.js";
import type { DashboardInputContext } from "./types.js";

export function handleDashboardKeyInput(context: DashboardInputContext): void {
  if (context.event.input === "H" || context.event.input === "?") {
    context.dashboard.setUiState((current) => openHelpOverlay(current));
    return;
  }

  if (
    context.persistentPopup &&
    context.onDismiss !== undefined &&
    (context.event.input === "q" ||
      context.event.input === "Q" ||
      context.event.key.escape === true)
  ) {
    void dismissPersistentPopup(context.onDismiss, context.dashboard);
    return;
  }

  if (context.event.input === "q" || context.event.input === "Q") {
    context.onExit?.(0);
    return;
  }

  if (context.event.input === "/") {
    openPromptMode(context, "search");
    return;
  }

  if (context.event.input === "r" || context.event.input === "R") {
    void context.dashboard.reconcile("tui-refresh");
    return;
  }

  if (context.event.input === "x" || context.event.input === "X") {
    openPromptMode(context, "remove-slot");
    return;
  }

  if (context.snapshot === undefined) {
    return;
  }

  const dashboardKey = isReturnInput(context.event) ? "enter" : context.event.input;
  const intent = intentForDashboardKey(
    dashboardKey,
    context.snapshot,
    context.dashboard.uiState,
    dashboardKeyOptions(context.focusOrigin),
  );

  if (intent.type === "open-new-session-prompt") {
    openNewSessionFlow(context);
    return;
  }

  if (intent.type === "open-cleanup-prompt") {
    context.promptValueRef.current = "";
    context.promptModeRef.current = "confirm-cleanup";
    context.dashboard.setUiState((current) =>
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
    if (shouldUseFocusLifecycle(intent.command, focusLifecyclePresence(context))) {
      void dispatchFocusWithLifecycle(
        intent.command,
        context.dashboard,
        buildFocusLifecycleOptions({
          exitOnFocusSuccess: context.exitOnFocusSuccess,
          focusOrigin: context.focusOrigin,
          resolveFocusOrigin: context.resolveFocusOrigin,
          onFocusSuccess: context.onFocusSuccess,
          persistentPopup: context.persistentPopup,
          onExit: context.onExit,
        }),
      );
      return;
    }
    void context.dashboard.dispatchCommand(intent.command);
  }
}

function openPromptMode(context: DashboardInputContext, mode: PromptMode): void {
  context.promptValueRef.current = "";
  context.promptModeRef.current = mode;
  context.dashboard.setUiState((current) => openPrompt(current, mode));
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

function focusLifecyclePresence(context: DashboardInputContext): FocusLifecyclePresence {
  const options: FocusLifecyclePresence = {
    exitOnFocusSuccess: context.exitOnFocusSuccess,
    persistentPopup: context.persistentPopup,
  };
  if (context.resolveFocusOrigin !== undefined) {
    options.resolveFocusOrigin = context.resolveFocusOrigin;
  }
  if (context.onFocusSuccess !== undefined) {
    options.onFocusSuccess = context.onFocusSuccess;
  }
  return options;
}
