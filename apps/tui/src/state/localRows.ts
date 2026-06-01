import type { CommandId, ProviderId, SafeError, WosmSnapshot } from "@wosm/contracts";
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

export type TuiLocalRows = {
  pendingCreate: PendingCreateSessionRow[];
  failedCreate: FailedCreateSessionRow[];
};

export function createEmptyTuiLocalRows(): TuiLocalRows {
  return {
    pendingCreate: [],
    failedCreate: [],
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
    },
  };
}

export function removeCreateSessionLocalRow(state: TuiState, localId: string): TuiState {
  return {
    ...state,
    localRows: {
      pendingCreate: state.localRows.pendingCreate.filter((row) => row.localId !== localId),
      failedCreate: state.localRows.failedCreate.filter((row) => row.localId !== localId),
    },
  };
}

export function pruneCreateSessionLocalRowsForSnapshot(
  localRows: TuiLocalRows,
  snapshot: WosmSnapshot,
): TuiLocalRows {
  const realRows = new Set(snapshot.rows.map((row) => `${row.projectId}\u0000${row.branch}`));
  return {
    ...localRows,
    pendingCreate: localRows.pendingCreate.filter(
      (row) => !realRows.has(`${row.projectId}\u0000${row.branch}`),
    ),
  };
}
