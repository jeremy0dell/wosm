import { safeErrorToNotice, toSafeError as toClientSafeError } from "@wosm/client";
import type { SafeError } from "@wosm/contracts";

export const safeErrorToToast = safeErrorToNotice;

export type ToSafeErrorOptions = {
  clientLabel?: string;
};

export function toSafeError(error: unknown, options: ToSafeErrorOptions = {}): SafeError {
  const clientLabel = options.clientLabel ?? "TUI";
  return toClientSafeError(error, { clientLabel });
}
