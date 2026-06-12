import type { CommandId, SafeError } from "@wosm/contracts";
import type { TerminalCommandRecord } from "@wosm/protocol";
import { isSafeError, type RuntimeSafeErrorFallback } from "@wosm/runtime";
import { observerErrorFallback, timeoutErrorFallback } from "./errors.js";
import type { WosmClientCommandCompletion } from "./types.js";

export type CommandWaitErrorCopy = {
  failed: string;
  timeout: string;
};

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

export function mapCommandWaitError(
  error: unknown,
  copy: CommandWaitErrorCopy = {
    failed: "The client could not observe command completion.",
    timeout: "The client timed out while waiting for command completion.",
  },
): RuntimeSafeErrorFallback {
  if (isSafeError(error) && error.tag === "TimeoutError") {
    return timeoutErrorFallback("CLIENT_COMMAND_WAIT_TIMEOUT", copy.timeout);
  }
  return observerErrorFallback("CLIENT_COMMAND_WAIT_FAILED", copy.failed);
}

function missingCommandError(commandId: CommandId): SafeError {
  return {
    tag: "ClientObserverError",
    code: "CLIENT_COMMAND_FAILED_WITHOUT_ERROR",
    message: "The observer command failed without an error payload.",
    commandId,
  };
}
