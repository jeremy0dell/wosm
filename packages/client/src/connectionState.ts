import type { SafeError } from "@wosm/contracts";
import type { ClientNotice } from "./types.js";

const OBSERVER_CONNECT_ERROR_CODES = new Set<SafeError["code"]>([
  "PROTOCOL_CONNECT_FAILED",
  "PROTOCOL_CONNECT_TIMEOUT",
]);

export function isObserverConnectError(error: SafeError): boolean {
  return OBSERVER_CONNECT_ERROR_CODES.has(error.code);
}

export function observerConnectNotice(): ClientNotice {
  return {
    kind: "error",
    message: "Observer is reconnecting.",
    hint: "Try the command again when the observer is ready.",
  };
}
