import type { WorktreeId } from "@wosm/contracts";
import type { CleanupActionKind } from "./actions.js";

export type PromptMode = "new-session" | "search" | "confirm-cleanup";

export type TuiTextPromptState = {
  mode: "new-session" | "search";
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

export type TuiUiState = {
  searchQuery: string;
  collapsedProjectIds: ReadonlySet<string>;
  selectedWorktreeId?: WorktreeId;
  prompt?: TuiPromptState;
};

export type CreateInitialUiStateOptions = {
  searchQuery?: string;
  collapsedProjectIds?: Iterable<string>;
  selectedWorktreeId?: WorktreeId;
};

export function createInitialUiState(options: CreateInitialUiStateOptions = {}): TuiUiState {
  const state: TuiUiState = {
    searchQuery: options.searchQuery ?? "",
    collapsedProjectIds: new Set(options.collapsedProjectIds ?? []),
  };
  if (options.selectedWorktreeId !== undefined) {
    state.selectedWorktreeId = options.selectedWorktreeId;
  }
  return state;
}

export function setSearchQuery(state: TuiUiState, searchQuery: string): TuiUiState {
  const next: TuiUiState = {
    ...state,
    searchQuery,
  };
  if (state.selectedWorktreeId !== undefined) {
    next.selectedWorktreeId = state.selectedWorktreeId;
  }
  if (state.prompt !== undefined) {
    next.prompt = state.prompt;
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
    ...state,
    collapsedProjectIds,
  };
  if (state.selectedWorktreeId !== undefined) {
    next.selectedWorktreeId = state.selectedWorktreeId;
  }
  if (state.prompt !== undefined) {
    next.prompt = state.prompt;
  }
  return next;
}

export function selectWorktree(state: TuiUiState, selectedWorktreeId: WorktreeId): TuiUiState {
  const next: TuiUiState = {
    ...state,
    selectedWorktreeId,
  };
  if (state.prompt !== undefined) {
    next.prompt = state.prompt;
  }
  return next;
}

export function openPrompt(state: TuiUiState, mode: PromptMode): TuiUiState {
  if (mode === "confirm-cleanup") {
    return state;
  }
  const next: TuiUiState = {
    ...state,
    prompt: { mode, value: "" },
  };
  if (state.selectedWorktreeId !== undefined) {
    next.selectedWorktreeId = state.selectedWorktreeId;
  }
  return next;
}

export function openCleanupPrompt(
  state: TuiUiState,
  prompt: Omit<TuiCleanupPromptState, "mode" | "value">,
): TuiUiState {
  const next: TuiUiState = {
    ...state,
    prompt: {
      mode: "confirm-cleanup",
      value: "",
      action: prompt.action,
      rowId: prompt.rowId,
      forceRequired: prompt.forceRequired,
      label: prompt.label,
    },
  };
  if (state.selectedWorktreeId !== undefined) {
    next.selectedWorktreeId = state.selectedWorktreeId;
  }
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
    ...state,
    prompt: {
      ...state.prompt,
      value,
    },
  };
  if (state.selectedWorktreeId !== undefined) {
    next.selectedWorktreeId = state.selectedWorktreeId;
  }
  return next;
}

export function closePrompt(state: TuiUiState): TuiUiState {
  const next: TuiUiState = {
    searchQuery: state.searchQuery,
    collapsedProjectIds: state.collapsedProjectIds,
  };
  if (state.selectedWorktreeId !== undefined) {
    next.selectedWorktreeId = state.selectedWorktreeId;
  }
  return next;
}
