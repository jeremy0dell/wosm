import type { SafeError } from "@wosm/contracts";
import type { RuntimeSafeErrorFallback } from "@wosm/runtime";
import { isObserverConnectError, observerConnectNotice } from "./connectionState.js";
import type { ClientNotice } from "./types.js";

// User-visible message copy in this package is frozen byte-identical from the
// TUI extraction (some strings still say "TUI"); cross-app wording is deferred
// messaging work tracked in the client package plan.
export function toSafeError(error: unknown): SafeError {
  if (isSafeError(error)) {
    return error;
  }
  const cause = safeErrorCause(error);
  if (cause !== undefined) {
    return cause;
  }
  return {
    tag: "ClientObserverError",
    code: "CLIENT_OBSERVER_OPERATION_FAILED",
    message: "The TUI could not complete the observer operation.",
  };
}

export function safeErrorToNotice(error: SafeError): ClientNotice {
  if (isObserverConnectError(error)) {
    return observerConnectNotice();
  }

  const notice: ClientNotice = {
    kind: "error",
    message: error.message,
  };
  if (error.hint !== undefined) notice.hint = error.hint;
  if (error.commandId !== undefined) notice.commandId = error.commandId;
  if (error.traceId !== undefined) notice.traceId = error.traceId;
  if (error.diagnosticId !== undefined) notice.diagnosticId = error.diagnosticId;
  return notice;
}

export function observerErrorFallback(code: string, message: string): RuntimeSafeErrorFallback {
  return {
    tag: "ClientObserverError",
    code,
    message,
  };
}

export function timeoutErrorFallback(code: string, message: string): RuntimeSafeErrorFallback {
  return {
    tag: "TimeoutError",
    code,
    message,
  };
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
