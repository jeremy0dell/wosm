import type { CommandId, SafeError } from "@wosm/contracts";
import type { TerminalCommandRecord } from "@wosm/protocol";
import { isSafeError, type RuntimeSafeErrorFallback } from "@wosm/runtime";
import { observerErrorFallback, timeoutErrorFallback } from "./errors.js";
import type { WosmClientCommandCompletion } from "./types.js";

export function completionFromTerminalRecord(
  record: TerminalCommandRecord,
): WosmClientCommandCompletion {
  if (record.status === "succeeded") {
    return {
      status: "succeeded",
      commandId: record.id,
    };
  }
  return {
    status: "failed",
    commandId: record.id,
    error: record.error ?? missingCommandError(record.id),
  };
}

export function mapCommandWaitError(error: unknown): RuntimeSafeErrorFallback {
  if (isSafeError(error) && error.tag === "TimeoutError") {
    return timeoutErrorFallback(
      "CLIENT_COMMAND_WAIT_TIMEOUT",
      "The TUI timed out while waiting for command completion.",
    );
  }
  return observerErrorFallback(
    "CLIENT_COMMAND_WAIT_FAILED",
    "The TUI could not observe command completion.",
  );
}

function missingCommandError(commandId: CommandId): SafeError {
  return {
    tag: "ClientObserverError",
    code: "CLIENT_COMMAND_FAILED_WITHOUT_ERROR",
    message: "The observer command failed without an error payload.",
    commandId,
  };
}
