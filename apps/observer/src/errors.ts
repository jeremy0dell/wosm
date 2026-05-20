import {
  type ErrorEnvelope,
  ErrorEnvelopeSchema,
  type SafeError,
  SafeErrorSchema,
} from "@wosm/contracts";
import { type RuntimeSafeErrorFallback, safeErrorFromUnknown } from "@wosm/runtime";

export type ErrorEnvelopeInput = {
  id: string;
  error: unknown;
  fallback: RuntimeSafeErrorFallback;
  createdAt: string;
  severity?: ErrorEnvelope["severity"];
  commandId?: string;
  traceId?: string;
  spanId?: string;
  projectId?: string;
  worktreeId?: string;
  sessionId?: string;
  provider?: string;
  raw?: unknown;
};

export function toSafeError(
  error: unknown,
  fallback: RuntimeSafeErrorFallback = {
    tag: "ObserverError",
    code: "OBSERVER_UNKNOWN",
    message: "Observer operation failed.",
  },
  context: Partial<Pick<SafeError, "commandId" | "projectId" | "worktreeId" | "sessionId">> = {},
): SafeError {
  const safeError = safeErrorFromUnknown(error, fallback);
  return SafeErrorSchema.parse({
    ...safeError,
    ...context,
  });
}

export function createErrorEnvelope(input: ErrorEnvelopeInput): ErrorEnvelope {
  const safeError = toSafeError(input.error, input.fallback, {
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  });
  const errorObject = input.error instanceof Error ? input.error : undefined;
  const provider = input.provider ?? safeError.provider;

  return ErrorEnvelopeSchema.parse({
    id: input.id,
    tag: safeError.tag,
    code: safeError.code,
    message: errorObject?.message ?? safeError.message,
    severity: input.severity ?? "error",
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    ...(input.spanId === undefined ? {} : { spanId: input.spanId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(provider === undefined ? {} : { provider }),
    ...(errorObject === undefined ? {} : { cause: errorObject.message }),
    ...(errorObject?.stack === undefined ? {} : { stack: errorObject.stack }),
    ...(input.raw === undefined ? {} : { raw: input.raw }),
    redacted: true,
    createdAt: input.createdAt,
  });
}
