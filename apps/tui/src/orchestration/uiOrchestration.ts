import type {
  CommandId,
  ProjectId,
  ProviderId,
  WorktreeRow,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";

export type PendingCreateSession = {
  id: string;
  projectId: ProjectId;
  branch: string;
  harnessProvider: ProviderId;
  commandId?: CommandId;
};

export type UiOrchestrationState = {
  pendingCreates: PendingCreateSession[];
};

export type AddPendingCreateInput = {
  id: string;
  projectId: ProjectId;
  branch: string;
  harnessProvider: ProviderId;
};

export function createInitialUiOrchestrationState(): UiOrchestrationState {
  return {
    pendingCreates: [],
  };
}

export function addPendingCreate(
  state: UiOrchestrationState,
  input: AddPendingCreateInput,
): UiOrchestrationState {
  return {
    pendingCreates: [
      ...state.pendingCreates,
      {
        id: input.id,
        projectId: input.projectId,
        branch: input.branch,
        harnessProvider: input.harnessProvider,
      },
    ],
  };
}

export function attachPendingCreateCommand(
  state: UiOrchestrationState,
  pendingId: string,
  commandId: CommandId,
): UiOrchestrationState {
  return {
    pendingCreates: state.pendingCreates.map((pending) =>
      pending.id === pendingId ? { ...pending, commandId } : pending,
    ),
  };
}

export function removePendingCreate(
  state: UiOrchestrationState,
  pendingId: string,
): UiOrchestrationState {
  return {
    pendingCreates: state.pendingCreates.filter((pending) => pending.id !== pendingId),
  };
}

export function applySnapshotToUiOrchestration(
  state: UiOrchestrationState,
  snapshot: WosmSnapshot,
): UiOrchestrationState {
  return removeProviderTruthMatches(state, snapshot.rows);
}

export function applyEventToUiOrchestration(
  state: UiOrchestrationState,
  event: WosmEvent,
): UiOrchestrationState {
  if (event.type === "command.failed") {
    return {
      pendingCreates: state.pendingCreates.filter(
        (pending) => pending.commandId !== event.commandId,
      ),
    };
  }
  if (event.type === "worktree.added") {
    return removeProviderTruthMatches(state, [event.row]);
  }
  return state;
}

function removeProviderTruthMatches(
  state: UiOrchestrationState,
  rows: readonly WorktreeRow[],
): UiOrchestrationState {
  if (state.pendingCreates.length === 0 || rows.length === 0) {
    return state;
  }
  return {
    pendingCreates: state.pendingCreates.filter(
      (pending) =>
        !rows.some((row) => row.projectId === pending.projectId && row.branch === pending.branch),
    ),
  };
}
