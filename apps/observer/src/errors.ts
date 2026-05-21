import type { ErrorEnvelope, SafeError } from "@wosm/contracts";
import {
  createErrorEnvelope as createObservabilityErrorEnvelope,
  type ErrorEnvelopeInput,
  type SafeErrorFallback,
  toSafeError as toObservabilitySafeError,
} from "@wosm/observability";

export type { ErrorEnvelopeInput };

export function toSafeError(
  error: unknown,
  fallback: SafeErrorFallback = {
    tag: "ObserverError",
    code: "OBSERVER_UNKNOWN",
    message: "Observer operation failed.",
  },
  context: Partial<
    Pick<
      SafeError,
      "commandId" | "projectId" | "worktreeId" | "sessionId" | "traceId" | "diagnosticId"
    >
  > = {},
): SafeError {
  return toObservabilitySafeError(error, fallback, context);
}

export function createErrorEnvelope(input: ErrorEnvelopeInput): ErrorEnvelope {
  return createObservabilityErrorEnvelope(input);
}
