import type { SafeError } from "@wosm/contracts";
import type { StoreApi } from "zustand/vanilla";
import { safeErrorToToast, toSafeError } from "../../services/errors/errors.js";
import type { TuiObserverService } from "../../services/types.js";
import { bindPendingRemoveWorktreeRow } from "../localRows.js";
import type { TuiStore } from "../store.js";
import type { RemoveWorktreeOperation } from "./types.js";

export async function runRemoveWorktreeOperation(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  operation: RemoveWorktreeOperation,
  markRemoveWorktreeRowFailed: (localId: string) => void,
  addSafeErrorToast: (error: SafeError) => void,
): Promise<void> {
  try {
    const receipt = await service.dispatch(operation.command);
    if (!receipt.accepted) {
      const safeError = receipt.error ?? {
        tag: "CommandExecutionError",
        code: "COMMAND_REJECTED",
        message: `${operation.command.type} was rejected.`,
      };
      markRemoveWorktreeRowFailed(operation.localId);
      addSafeErrorToast(safeError);
      return;
    }

    store.setState(
      bindPendingRemoveWorktreeRow(store.getState(), operation.localId, receipt.commandId),
    );
    const completion = await service.waitForCommandCompletion(receipt.commandId);
    if (completion.status === "failed") {
      markRemoveWorktreeRowFailed(operation.localId);
      addSafeErrorToast(completion.error);
    }
  } catch (error: unknown) {
    markRemoveWorktreeRowFailed(operation.localId);
    addSafeErrorToast(toSafeError(error));
  }
}

export function addRemoveWorktreeErrorToast(store: StoreApi<TuiStore>, error: SafeError): void {
  store.setState((state) => ({
    toasts: [...state.toasts, safeErrorToToast(error)],
  }));
}
