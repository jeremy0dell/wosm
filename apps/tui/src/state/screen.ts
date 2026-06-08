import type {
  SafeError,
  SessionId,
  TerminalFocusOrigin,
  WorktreeId,
  WosmSnapshot,
} from "@wosm/contracts";
import type { EditableTextInputState } from "../components/EditableTextInput/editing.js";
import type { AddProjectFlowState } from "../flows/addProject/types.js";
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
  toasts: TuiToastEntry[];
  observerConnectionStatus: TuiObserverConnectionStatus;
  runtime: TuiRuntimeState;
};

export type TuiToastEntry = {
  id: string;
  toast: TuiToast;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
};

export type TuiObserverConnectionStatus =
  | { state: "connected" }
  | { state: "reconnecting"; since: number; lastError?: SafeError }
  | { state: "displayOnly"; since: number; lastError?: SafeError };

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
  | { name: "renameSession"; step: "chooseSlot" }
  | {
      name: "renameSession";
      step: "editName";
      rowId: WorktreeId;
      sessionId: SessionId;
      currentTitle: string;
      draftTitle: EditableTextInputState;
      validationError?: string;
    }
  | { name: "addProject"; flow: AddProjectFlowState }
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
    observerConnectionStatus: { state: "connected" },
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

export function addTuiToast(state: TuiState, toast: TuiToast, nowMs = Date.now()): TuiState {
  const current = expireTuiToasts(state, nowMs);
  const active = activeTuiToast(current);
  const expiresAt = nowMs + toastExpiryMs(toast.kind);

  if (active !== undefined && toastKey(active.toast) === toastKey(toast)) {
    return {
      ...current,
      toasts: current.toasts.map((entry) =>
        entry.id === active.id
          ? {
              ...entry,
              toast,
              updatedAt: nowMs,
              expiresAt,
            }
          : entry,
      ),
    };
  }

  const entry: TuiToastEntry = {
    id: toastEntryId(toast, nowMs),
    toast,
    createdAt: nowMs,
    updatedAt: nowMs,
    expiresAt,
  };

  return {
    ...current,
    toasts: [...current.toasts, entry].slice(-3),
  };
}

export function addTuiToasts(
  state: TuiState,
  toasts: readonly TuiToast[],
  nowMs = Date.now(),
): TuiState {
  if (toasts.length === 0) {
    return state;
  }
  return toasts.reduce((current, toast) => addTuiToast(current, toast, nowMs), state);
}

export function expireTuiToasts(state: TuiState, nowMs = Date.now()): TuiState {
  const toasts = state.toasts.filter(
    (entry) => entry.expiresAt === undefined || entry.expiresAt > nowMs,
  );
  if (toasts.length === state.toasts.length) {
    return state;
  }
  return {
    ...state,
    toasts,
  };
}

export function activeTuiToast(state: Pick<TuiState, "toasts">): TuiToastEntry | undefined {
  return state.toasts.at(-1);
}

export function nextTuiToastExpiry(state: Pick<TuiState, "toasts">): number | undefined {
  return state.toasts.reduce<number | undefined>((next, entry) => {
    if (entry.expiresAt === undefined) {
      return next;
    }
    return next === undefined ? entry.expiresAt : Math.min(next, entry.expiresAt);
  }, undefined);
}

export function toastExpiryMs(kind: TuiToast["kind"]): number {
  switch (kind) {
    case "success":
      return 2_400;
    case "info":
      return 3_200;
    case "error":
      return 8_000;
  }
}

export function toastKey(toast: TuiToast): string {
  return JSON.stringify([
    toast.kind,
    toast.message,
    toast.hint ?? null,
    toast.commandId ?? null,
    toast.traceId ?? null,
    toast.diagnosticId ?? null,
  ]);
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

function toastEntryId(toast: TuiToast, nowMs: number): string {
  return `${nowMs}:${toastKey(toast)}`;
}
