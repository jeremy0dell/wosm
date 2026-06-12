import { safeErrorToNotice, toSafeError as toClientSafeError } from "@wosm/client";
import type { SafeError } from "@wosm/contracts";

export const safeErrorToToast = safeErrorToNotice;

export function toSafeError(error: unknown): SafeError {
  return toClientSafeError(error, { clientLabel: "TUI" });
}
