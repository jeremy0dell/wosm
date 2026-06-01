import type { CommandId, ProviderId, SafeError, WorktreeId, WosmSnapshot } from "@wosm/contracts";
import type { TuiState } from "./screen.js";

export type PendingCreateSessionRow = {
  localId: string;
  projectId: string;
  branch: string;
  harnessProvider: ProviderId;
  createdAt: string;
  commandId?: CommandId;
};

export type FailedCreateSessionRow = {
  localId: string;
  projectId: string;
  branch: string;
  error: SafeError;
  expiresAt: number;
};

export type PendingRemoveWorktreeRow = {
  localId: string;
  projectId: string;
  worktreeId: WorktreeId;
  branch: string;
  createdAt: string;
  commandId?: CommandId;
};

export type TuiLocalRows = {
  pendingCreate: PendingCreateSessionRow[];
  failedCreate: FailedCreateSessionRow[];
  pendingRemove: PendingRemoveWorktreeRow[];
};

export function createEmptyTuiLocalRows(): TuiLocalRows {
  return {
    pendingCreate: [],
    failedCreate: [],
    pendingRemove: [],
  };
}

export function addPendingCreateSessionRow(
  state: TuiState,
  row: PendingCreateSessionRow,
): TuiState {
  return {
    ...state,
    localRows: {
      ...state.localRows,
      pendingCreate: [...state.localRows.pendingCreate, row],
    },
  };
}

export function bindPendingCreateSessionRow(
  state: TuiState,
  localId: string,
  commandId: CommandId,
): TuiState {
  return {
    ...state,
    localRows: {
      ...state.localRows,
      pendingCreate: state.localRows.pendingCreate.map((row) => {
        if (row.localId !== localId) {
          return row;
        }
        return { ...row, commandId };
      }),
    },
  };
}

export function failPendingCreateSessionRow(
  state: TuiState,
  localId: string,
  error: SafeError,
  expiresAt: number,
): TuiState {
  const row = state.localRows.pendingCreate.find((candidate) => candidate.localId === localId);
  if (row === undefined) {
    return state;
  }
  return {
    ...state,
    localRows: {
      pendingCreate: state.localRows.pendingCreate.filter(
        (candidate) => candidate.localId !== localId,
      ),
      failedCreate: [
        ...state.localRows.failedCreate,
        {
          localId,
          projectId: row.projectId,
          branch: row.branch,
          error,
          expiresAt,
        },
      ],
      pendingRemove: state.localRows.pendingRemove,
    },
  };
}

export function removeCreateSessionLocalRow(state: TuiState, localId: string): TuiState {
  return {
    ...state,
    localRows: {
      pendingCreate: state.localRows.pendingCreate.filter((row) => row.localId !== localId),
      failedCreate: state.localRows.failedCreate.filter((row) => row.localId !== localId),
      pendingRemove: state.localRows.pendingRemove,
    },
  };
}

export function addPendingRemoveWorktreeRow(
  state: TuiState,
  row: PendingRemoveWorktreeRow,
): TuiState {
  return {
    ...state,
    localRows: {
      ...state.localRows,
      pendingRemove: [
        ...state.localRows.pendingRemove.filter(
          (candidate) => candidate.worktreeId !== row.worktreeId,
        ),
        row,
      ],
    },
  };
}

export function bindPendingRemoveWorktreeRow(
  state: TuiState,
  localId: string,
  commandId: CommandId,
): TuiState {
  return {
    ...state,
    localRows: {
      ...state.localRows,
      pendingRemove: state.localRows.pendingRemove.map((row) => {
        if (row.localId !== localId) {
          return row;
        }
        return { ...row, commandId };
      }),
    },
  };
}

export function removePendingRemoveWorktreeRow(state: TuiState, localId: string): TuiState {
  return {
    ...state,
    localRows: {
      ...state.localRows,
      pendingRemove: state.localRows.pendingRemove.filter((row) => row.localId !== localId),
    },
  };
}

export function pruneLocalRowsForSnapshot(
  localRows: TuiLocalRows,
  snapshot: WosmSnapshot,
): TuiLocalRows {
  const realRows = new Set(snapshot.rows.map((row) => `${row.projectId}\u0000${row.branch}`));
  const realWorktreeIds = new Set(snapshot.rows.map((row) => row.id));
  return {
    ...localRows,
    pendingCreate: localRows.pendingCreate.filter(
      (row) => !realRows.has(`${row.projectId}\u0000${row.branch}`),
    ),
    pendingRemove: localRows.pendingRemove.filter((row) => realWorktreeIds.has(row.worktreeId)),
  };
}
