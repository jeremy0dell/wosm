import type { TerminalFocusOrigin, WorktreeId, WosmSnapshot } from "@wosm/contracts";
import type { NewSessionFlowState } from "../flows/newSession.js";
import type { TuiToast } from "../services/types.js";
import {
  createEmptyTuiLocalRows,
  pruneLocalRowsForSnapshot,
  type TuiLocalRows,
} from "./localRows.js";

export type TuiRuntimeState = {
  persistentPopup: boolean;
  canDismissPopup: boolean;
  exitOnFocusSuccess: boolean;
  canResolveFocusOrigin: boolean;
  hasFocusSuccessCallback: boolean;
  focusOrigin?: TerminalFocusOrigin;
};

export type TuiViewState = {
  searchQuery: string;
  collapsedProjectIds: ReadonlySet<string>;
  scrollOffset: number;
  terminalRows: number;
  localRows: TuiLocalRows;
};

export type TuiState = TuiViewState & {
  snapshot?: WosmSnapshot;
  loading: boolean;
  screen: TuiScreen;
  toasts: TuiToast[];
  runtime: TuiRuntimeState;
};

export type TuiScreen =
  | { name: "dashboard" }
  | { name: "help" }
  | { name: "search"; value: string }
  | { name: "projectCollapse"; value: string }
  | { name: "removeWorktree"; step: "chooseSlot" }
  | {
      name: "removeWorktree";
      step: "confirm";
      rowId: WorktreeId;
      forceRequired: boolean;
      label: string;
    }
  | { name: "newSession"; flow: NewSessionFlowState };

export type CreateInitialTuiStateOptions = {
  initialSnapshot?: WosmSnapshot;
  searchQuery?: string;
  collapsedProjectIds?: Iterable<string>;
  scrollOffset?: number;
  terminalRows?: number;
  localRows?: TuiLocalRows;
  runtime?: Partial<TuiRuntimeState>;
};

export function createInitialTuiState(options: CreateInitialTuiStateOptions = {}): TuiState {
  const runtime = createRuntimeState(options.runtime);
  const state: TuiState = {
    loading: options.initialSnapshot === undefined,
    screen: { name: "dashboard" },
    toasts: [],
    searchQuery: options.searchQuery ?? "",
    collapsedProjectIds: new Set(options.collapsedProjectIds ?? []),
    scrollOffset: options.scrollOffset ?? 0,
    terminalRows: options.terminalRows ?? 24,
    localRows: options.localRows ?? createEmptyTuiLocalRows(),
    runtime,
  };
  if (options.initialSnapshot !== undefined) {
    state.snapshot = options.initialSnapshot;
  }
  return state;
}

export function replaceSnapshot(state: TuiState, snapshot: WosmSnapshot): TuiState {
  return {
    ...state,
    snapshot,
    loading: false,
    localRows: pruneLocalRowsForSnapshot(state.localRows, snapshot),
  };
}

export function addTuiToast(state: TuiState, toast: TuiToast): TuiState {
  return {
    ...state,
    toasts: [...state.toasts, toast],
  };
}

export function addTuiToasts(state: TuiState, toasts: readonly TuiToast[]): TuiState {
  if (toasts.length === 0) {
    return state;
  }
  return {
    ...state,
    toasts: [...state.toasts, ...toasts],
  };
}

function createRuntimeState(runtime: Partial<TuiRuntimeState> | undefined): TuiRuntimeState {
  const built: TuiRuntimeState = {
    persistentPopup: runtime?.persistentPopup ?? false,
    canDismissPopup: runtime?.canDismissPopup ?? false,
    exitOnFocusSuccess: runtime?.exitOnFocusSuccess ?? false,
    canResolveFocusOrigin: runtime?.canResolveFocusOrigin ?? false,
    hasFocusSuccessCallback: runtime?.hasFocusSuccessCallback ?? false,
  };
  if (runtime?.focusOrigin !== undefined) {
    built.focusOrigin = runtime.focusOrigin;
  }
  return built;
}
