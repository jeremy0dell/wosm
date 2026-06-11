import type { SafeError } from "@wosm/contracts";
import type { ClientNotice, WosmClientConnectionState } from "./types.js";

const OBSERVER_CONNECT_ERROR_CODES = new Set<SafeError["code"]>([
  "PROTOCOL_CONNECT_FAILED",
  "PROTOCOL_CONNECT_TIMEOUT",
]);

export function isObserverConnectError(error: SafeError): boolean {
  return OBSERVER_CONNECT_ERROR_CODES.has(error.code);
}

export function connectedConnectionState(
  previous: WosmClientConnectionState,
  nowMs: number,
): WosmClientConnectionState {
  return previous.state === "connected" ? previous : { state: "connected", since: nowMs };
}

// displayOnly iff a last good snapshot exists, reconnecting otherwise; `since`
// is preserved when re-entering the same failure state so downtime accumulates
// across repeated failures instead of resetting on every retry.
export function failureConnectionState(
  previous: WosmClientConnectionState,
  error: SafeError,
  hasSnapshot: boolean,
  nowMs: number,
): WosmClientConnectionState {
  const statusState = hasSnapshot ? "displayOnly" : "reconnecting";
  const since = previous.state === statusState ? previous.since : nowMs;
  return { state: statusState, since, lastError: error };
}

// Terminal state for permanent errors: the runtime stops retrying but keeps
// the last good snapshot available.
export function haltedConnectionState(error: SafeError, nowMs: number): WosmClientConnectionState {
  return { state: "halted", since: nowMs, lastError: error };
}

export function observerConnectNotice(): ClientNotice {
  return {
    kind: "error",
    message: "Observer is reconnecting.",
    hint: "Try the command again when the observer is ready.",
  };
}
