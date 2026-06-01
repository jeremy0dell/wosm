import type { CommandId, SafeError, WosmEvent } from "@wosm/contracts";
import type { StoreApi } from "zustand/vanilla";
import { safeErrorToToast } from "../../services/errors/errors.js";
import type { TuiObserverService } from "../../services/types.js";
import {
  failPendingCreateSessionRow,
  removeCreateSessionLocalRow,
  removePendingRemoveWorktreeRow,
  removePendingRenameSessionTitle,
  removePendingStartAgentRow,
} from "../localRows.js";
import type { TuiState } from "../screen.js";
import type { TuiStore } from "../store.js";
import { runCreateSessionOperation } from "./createSession.js";
import { runRemoveWorktreeOperation } from "./removeWorktree.js";
import { runRenameSessionOperation } from "./renameSession.js";
import type { CommandRuntimeOptions } from "./runtimeCommands.js";
import { type FocusStartedAgentRow, runStartAgentOperation } from "./startAgent.js";
import type { TuiOperation } from "./types.js";

export type CommandFailedEventHandling = {
  suppressReducerToast: boolean;
  applyLocalEffect(): void;
};

export type TuiLocalOperationRunner = {
  run(operations: readonly TuiOperation[] | undefined): void;
  prepareCommandFailedEvent(event: CommandFailedEvent): CommandFailedEventHandling;
};

type CommandFailedEvent = Extract<WosmEvent, { type: "command.failed" }>;

type LocalCommandFailure =
  | { type: "createSession"; localId: string }
  | { type: "removeWorktree"; localId: string }
  | { type: "startAgent"; localId: string }
  | { type: "renameSession"; sessionId: string };

const FAILED_CREATE_ROW_TTL_MS = 4_000;

function localCommandFailureForState(
  state: TuiState,
  commandId: CommandId,
): LocalCommandFailure | undefined {
  const createRow = state.localRows.pendingCreate.find(
    (candidate) => candidate.commandId === commandId,
  );
  if (createRow !== undefined) {
    return { type: "createSession", localId: createRow.localId };
  }
  const removeRow = state.localRows.pendingRemove.find(
    (candidate) => candidate.commandId === commandId,
  );
  if (removeRow !== undefined) {
    return { type: "removeWorktree", localId: removeRow.localId };
  }
  const startRow = state.localRows.pendingStart.find(
    (candidate) => candidate.commandId === commandId,
  );
  if (startRow !== undefined) {
    return { type: "startAgent", localId: startRow.localId };
  }
  const renameRow = Object.values(state.localRows.pendingRenameTitles ?? {}).find(
    (candidate) => candidate.commandId === commandId,
  );
  if (renameRow !== undefined) {
    return { type: "renameSession", sessionId: renameRow.sessionId };
  }
  return undefined;
}

function markCreateSessionRowFailed(
  store: StoreApi<TuiStore>,
  localId: string,
  error: SafeError,
): void {
  store.setState(
    failPendingCreateSessionRow(
      store.getState(),
      localId,
      error,
      Date.now() + FAILED_CREATE_ROW_TTL_MS,
    ),
  );
  setTimeout(() => {
    store.setState(removeCreateSessionLocalRow(store.getState(), localId));
  }, FAILED_CREATE_ROW_TTL_MS);
}

function markRemoveWorktreeRowFailed(store: StoreApi<TuiStore>, localId: string): void {
  store.setState(removePendingRemoveWorktreeRow(store.getState(), localId));
}

function markStartAgentRowFailed(store: StoreApi<TuiStore>, localId: string): void {
  store.setState(removePendingStartAgentRow(store.getState(), localId));
}

function markRenameSessionFailed(store: StoreApi<TuiStore>, sessionId: string): void {
  store.setState(removePendingRenameSessionTitle(store.getState(), sessionId));
}

function addSafeErrorToast(store: StoreApi<TuiStore>, error: SafeError): void {
  store.setState((state) => ({
    toasts: [...state.toasts, safeErrorToToast(error)],
  }));
}

function addRenameSuccessToast(store: StoreApi<TuiStore>): void {
  store.setState((state) => ({
    toasts: [
      ...state.toasts,
      {
        kind: "success",
        message: "Session renamed.",
      },
    ],
  }));
}

export function createTuiLocalOperationRunner(input: {
  getStore: () => StoreApi<TuiStore>;
  service: TuiObserverService;
  runtime: CommandRuntimeOptions;
  focusStartedAgentRow: FocusStartedAgentRow;
}): TuiLocalOperationRunner {
  const handledCommandFailureIds = new Set<CommandId>();
  const store = () => input.getStore();

  return {
    run: (operations) => {
      for (const operation of operations ?? []) {
        if (operation.type === "createSession") {
          void runCreateSessionOperation(
            store(),
            input.service,
            input.runtime,
            operation,
            (localId, error) => markCreateSessionRowFailed(store(), localId, error),
            (commandId) => handledCommandFailureIds.add(commandId),
            (commandId) => handledCommandFailureIds.has(commandId),
            (error) => addSafeErrorToast(store(), error),
          );
        }
        if (operation.type === "removeWorktree") {
          void runRemoveWorktreeOperation(
            store(),
            input.service,
            operation,
            (localId) => markRemoveWorktreeRowFailed(store(), localId),
            (commandId) => handledCommandFailureIds.add(commandId),
            (commandId) => handledCommandFailureIds.has(commandId),
            (error) => addSafeErrorToast(store(), error),
          );
        }
        if (operation.type === "startAgent") {
          void runStartAgentOperation(
            store(),
            input.service,
            input.runtime,
            operation,
            (localId) => markStartAgentRowFailed(store(), localId),
            (commandId) => handledCommandFailureIds.add(commandId),
            (commandId) => handledCommandFailureIds.has(commandId),
            (error) => addSafeErrorToast(store(), error),
            input.focusStartedAgentRow,
          );
        }
        if (operation.type === "renameSession") {
          void runRenameSessionOperation(
            store(),
            input.service,
            operation,
            (sessionId) => markRenameSessionFailed(store(), sessionId),
            (commandId) => handledCommandFailureIds.add(commandId),
            (commandId) => handledCommandFailureIds.has(commandId),
            (error) => addSafeErrorToast(store(), error),
            () => addRenameSuccessToast(store()),
          );
        }
      }
    },
    prepareCommandFailedEvent: (event) => {
      const localFailure = localCommandFailureForState(store().getState(), event.commandId);
      const suppressReducerToast =
        localFailure !== undefined || handledCommandFailureIds.has(event.commandId);
      return {
        suppressReducerToast,
        applyLocalEffect: () => {
          if (localFailure === undefined) {
            return;
          }
          handledCommandFailureIds.add(event.commandId);
          if (localFailure.type === "createSession") {
            markCreateSessionRowFailed(store(), localFailure.localId, event.error);
          } else if (localFailure.type === "removeWorktree") {
            markRemoveWorktreeRowFailed(store(), localFailure.localId);
          } else if (localFailure.type === "startAgent") {
            markStartAgentRowFailed(store(), localFailure.localId);
          } else {
            markRenameSessionFailed(store(), localFailure.sessionId);
          }
          addSafeErrorToast(store(), event.error);
        },
      };
    },
  };
}
