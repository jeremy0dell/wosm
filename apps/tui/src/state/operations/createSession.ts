import type { SafeError, WosmCommand } from "@wosm/contracts";
import type { StoreApi } from "zustand/vanilla";
import { safeErrorToToast, toSafeError } from "../../services/errors/errors.js";
import type { TuiObserverService } from "../../services/types.js";
import { bindPendingCreateSessionRow } from "../localRows.js";
import type { TuiStore } from "../store.js";
import { type CommandRuntimeOptions, prepareCommandForRuntime } from "./runtimeCommands.js";
import type { CreateSessionOperation } from "./types.js";

export async function runCreateSessionOperation(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  runtime: CommandRuntimeOptions,
  operation: CreateSessionOperation,
  markCreateSessionRowFailed: (localId: string, error: SafeError) => void,
  addSafeErrorToast: (error: SafeError) => void,
): Promise<void> {
  try {
    const command = (await prepareCommandForRuntime(operation.command, runtime)) as Extract<
      WosmCommand,
      { type: "session.create" }
    >;
    const receipt = await service.dispatch(command);
    if (!receipt.accepted) {
      const safeError = receipt.error ?? {
        tag: "CommandExecutionError",
        code: "COMMAND_REJECTED",
        message: `${command.type} was rejected.`,
      };
      markCreateSessionRowFailed(operation.localId, safeError);
      addSafeErrorToast(safeError);
      return;
    }

    store.setState(
      bindPendingCreateSessionRow(store.getState(), operation.localId, receipt.commandId),
    );
    const completion = await service.waitForCommandCompletion(receipt.commandId);
    if (completion.status === "failed") {
      markCreateSessionRowFailed(operation.localId, completion.error);
      addSafeErrorToast(completion.error);
    }
  } catch (error: unknown) {
    const safeError = toSafeError(error);
    markCreateSessionRowFailed(operation.localId, safeError);
    addSafeErrorToast(safeError);
  }
}

export function addCreateSessionErrorToast(store: StoreApi<TuiStore>, error: SafeError): void {
  store.setState((state) => ({
    toasts: [...state.toasts, safeErrorToToast(error)],
  }));
}
