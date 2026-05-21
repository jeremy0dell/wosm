import type { WorktreeId } from "@wosm/contracts";

export type PromptMode = "new-session" | "search";

export type TuiPromptState = {
  mode: PromptMode;
  value: string;
};

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
  const next: TuiUiState = {
    ...state,
    prompt: { mode, value: "" },
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
