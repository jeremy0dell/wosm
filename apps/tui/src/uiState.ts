import type { WorktreeId } from "@wosm/contracts";
import type { CleanupActionKind } from "./actions.js";

export type PromptMode = "new-session" | "search" | "remove-slot" | "confirm-cleanup";

export type TuiTextPromptState = {
  mode: "new-session" | "search" | "remove-slot";
  value: string;
};

export type TuiCleanupPromptState = {
  mode: "confirm-cleanup";
  value: "";
  action: CleanupActionKind;
  rowId: WorktreeId;
  forceRequired: boolean;
  label: string;
};

export type TuiPromptState = TuiTextPromptState | TuiCleanupPromptState;

export type TuiOverlayState = "help";

export type TuiUiState = {
  searchQuery: string;
  collapsedProjectIds: ReadonlySet<string>;
  prompt?: TuiPromptState;
  activeOverlay?: TuiOverlayState;
};

export type CreateInitialUiStateOptions = {
  searchQuery?: string;
  collapsedProjectIds?: Iterable<string>;
};

export function createInitialUiState(options: CreateInitialUiStateOptions = {}): TuiUiState {
  const state: TuiUiState = {
    searchQuery: options.searchQuery ?? "",
    collapsedProjectIds: new Set(options.collapsedProjectIds ?? []),
  };
  return state;
}

export function setSearchQuery(state: TuiUiState, searchQuery: string): TuiUiState {
  const next: TuiUiState = {
    searchQuery,
    collapsedProjectIds: state.collapsedProjectIds,
  };
  if (state.prompt !== undefined) {
    next.prompt = state.prompt;
  }
  if (state.activeOverlay !== undefined) {
    next.activeOverlay = state.activeOverlay;
  }
  return next;
}

export function toggleProjectCollapsed(state: TuiUiState, projectId: string): TuiUiState {
  const collapsedProjectIds = new Set(state.collapsedProjectIds);
  if (collapsedProjectIds.has(projectId)) {
    collapsedProjectIds.delete(projectId);
  } else {
    collapsedProjectIds.add(projectId);
  }

  const next: TuiUiState = {
    searchQuery: state.searchQuery,
    collapsedProjectIds,
  };
  if (state.prompt !== undefined) {
    next.prompt = state.prompt;
  }
  if (state.activeOverlay !== undefined) {
    next.activeOverlay = state.activeOverlay;
  }
  return next;
}

export function openPrompt(state: TuiUiState, mode: PromptMode): TuiUiState {
  if (mode === "confirm-cleanup") {
    return state;
  }
  const next: TuiUiState = {
    searchQuery: state.searchQuery,
    collapsedProjectIds: state.collapsedProjectIds,
    prompt: { mode, value: "" },
  };
  return next;
}

export function openCleanupPrompt(
  state: TuiUiState,
  prompt: Omit<TuiCleanupPromptState, "mode" | "value">,
): TuiUiState {
  const next: TuiUiState = {
    searchQuery: state.searchQuery,
    collapsedProjectIds: state.collapsedProjectIds,
    prompt: {
      mode: "confirm-cleanup",
      value: "",
      action: prompt.action,
      rowId: prompt.rowId,
      forceRequired: prompt.forceRequired,
      label: prompt.label,
    },
  };
  return next;
}

export function updatePromptValue(state: TuiUiState, value: string): TuiUiState {
  if (state.prompt === undefined) {
    return state;
  }
  if (state.prompt.mode === "confirm-cleanup") {
    return state;
  }
  const next: TuiUiState = {
    searchQuery: state.searchQuery,
    collapsedProjectIds: state.collapsedProjectIds,
    prompt: {
      ...state.prompt,
      value,
    },
  };
  if (state.activeOverlay !== undefined) {
    next.activeOverlay = state.activeOverlay;
  }
  return next;
}

export function closePrompt(state: TuiUiState): TuiUiState {
  const next: TuiUiState = {
    searchQuery: state.searchQuery,
    collapsedProjectIds: state.collapsedProjectIds,
  };
  if (state.activeOverlay !== undefined) {
    next.activeOverlay = state.activeOverlay;
  }
  return next;
}

export function openHelpOverlay(state: TuiUiState): TuiUiState {
  if (state.prompt !== undefined) {
    return state;
  }
  return {
    searchQuery: state.searchQuery,
    collapsedProjectIds: state.collapsedProjectIds,
    activeOverlay: "help",
  };
}

export function closeOverlay(state: TuiUiState): TuiUiState {
  const next: TuiUiState = {
    searchQuery: state.searchQuery,
    collapsedProjectIds: state.collapsedProjectIds,
  };
  if (state.prompt !== undefined) {
    next.prompt = state.prompt;
  }
  return next;
}
