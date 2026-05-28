import { buildCleanupCommand, cleanupForceRequired } from "../actions.js";
import { selectKeySlots } from "../selectors.js";
import { closePrompt, openCleanupPrompt, setSearchQuery, updatePromptValue } from "../uiState.js";
import { isReturnInput } from "./keyEvents.js";
import type { DashboardInputContext } from "./types.js";

export function handlePromptInput(context: DashboardInputContext): void {
  const mode = context.dashboard.uiState.prompt?.mode ?? context.promptModeRef.current;
  if (mode === undefined) {
    return;
  }
  if (context.event.key.escape === true) {
    context.promptValueRef.current = "";
    context.promptModeRef.current = undefined;
    context.dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  if (context.event.key.backspace === true || context.event.key.delete === true) {
    context.promptValueRef.current = context.promptValueRef.current.slice(0, -1);
    context.dashboard.setUiState((current) =>
      updatePromptValue(current, context.promptValueRef.current),
    );
    return;
  }
  if (mode === "remove-slot") {
    if (/^[1-9]$/.test(context.event.input)) {
      openRemoveConfirmationForSlot(context, context.event.input);
    }
    return;
  }
  if (mode === "confirm-cleanup") {
    if (context.event.input === "y" || context.event.input === "Y") {
      submitCleanupPrompt(context);
      context.promptValueRef.current = "";
      context.promptModeRef.current = undefined;
      return;
    }
    if (
      context.event.input === "n" ||
      context.event.input === "N" ||
      isReturnInput(context.event)
    ) {
      context.promptValueRef.current = "";
      context.promptModeRef.current = undefined;
      context.dashboard.setUiState((current) => closePrompt(current));
    }
    return;
  }
  if (isReturnInput(context.event)) {
    context.dashboard.setUiState((current) =>
      closePrompt(setSearchQuery(current, context.promptValueRef.current)),
    );
    context.promptValueRef.current = "";
    context.promptModeRef.current = undefined;
    return;
  }
  if (context.event.input.length > 0) {
    context.promptValueRef.current = `${context.promptValueRef.current}${context.event.input}`;
    context.dashboard.setUiState((current) =>
      updatePromptValue(current, context.promptValueRef.current),
    );
  }
}

function openRemoveConfirmationForSlot(context: DashboardInputContext, slot: string): void {
  if (context.snapshot === undefined) {
    context.promptValueRef.current = "";
    context.promptModeRef.current = undefined;
    context.dashboard.setUiState((current) => closePrompt(current));
    return;
  }

  const row = selectKeySlots(context.snapshot, context.dashboard.uiState).get(slot);
  if (row === undefined) {
    return;
  }
  const action = "remove-worktree" as const;
  context.promptValueRef.current = "";
  context.promptModeRef.current = "confirm-cleanup";
  context.dashboard.setUiState((current) =>
    openCleanupPrompt(current, {
      action,
      rowId: row.id,
      forceRequired: cleanupForceRequired(row, action),
      label: `remove ${row.branch}? y/N`,
    }),
  );
}

function submitCleanupPrompt(context: DashboardInputContext): void {
  const prompt = context.dashboard.uiState.prompt;
  if (prompt?.mode !== "confirm-cleanup" || context.snapshot === undefined) {
    context.dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  const row = context.snapshot.rows.find((candidate) => candidate.id === prompt.rowId);
  if (row === undefined) {
    context.dashboard.setUiState((current) => closePrompt(current));
    return;
  }
  void context.dashboard.dispatchCommand(
    buildCleanupCommand(row, prompt.action, prompt.forceRequired),
  );
  context.dashboard.setUiState((current) => closePrompt(current));
}
