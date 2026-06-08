import type { SafeError } from "@wosm/contracts";
import type { TuiToast } from "../types.js";
import { isObserverConnectError, observerConnectErrorToast } from "./observerConnection.js";

export function toSafeError(error: unknown): SafeError {
  if (isSafeError(error)) {
    return error;
  }
  const cause = safeErrorCause(error);
  if (cause !== undefined) {
    return cause;
  }
  return {
    tag: "TuiObserverError",
    code: "TUI_OBSERVER_OPERATION_FAILED",
    message: "The TUI could not complete the observer operation.",
  };
}

export function safeErrorToToast(error: SafeError): TuiToast {
  if (isObserverConnectError(error)) {
    return observerConnectErrorToast();
  }

  const toast: TuiToast = {
    kind: "error",
    message: error.message,
  };
  if (error.hint !== undefined) toast.hint = error.hint;
  if (error.commandId !== undefined) toast.commandId = error.commandId;
  if (error.traceId !== undefined) toast.traceId = error.traceId;
  if (error.diagnosticId !== undefined) toast.diagnosticId = error.diagnosticId;
  return toast;
}

function isSafeError(value: unknown): value is SafeError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SafeError>;
  return (
    typeof candidate.tag === "string" &&
    candidate.tag.length > 0 &&
    typeof candidate.code === "string" &&
    candidate.code.length > 0 &&
    typeof candidate.message === "string" &&
    candidate.message.length > 0
  );
}

function safeErrorCause(error: unknown, seen = new Set<unknown>()): SafeError | undefined {
  if (!error || typeof error !== "object" || seen.has(error)) {
    return undefined;
  }
  seen.add(error);
  const cause = (error as { cause?: unknown }).cause;
  if (isSafeError(cause)) {
    return cause;
  }
  return safeErrorCause(cause, seen);
}
