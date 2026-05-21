import {
  type ErrorEnvelope,
  ErrorEnvelopeSchema,
  type SafeError,
  SafeErrorSchema,
} from "@wosm/contracts";
import { redact } from "./redaction.js";

export type SafeErrorFallback = {
  tag: string;
  code: string;
  message: string;
  hint?: string;
  provider?: string;
};

export type ErrorEnvelopeInput = {
  id: string;
  error: unknown;
  fallback: SafeErrorFallback;
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
  fallback: SafeErrorFallback,
  context: Partial<
    Pick<
      SafeError,
      "commandId" | "projectId" | "worktreeId" | "sessionId" | "traceId" | "diagnosticId"
    >
  > = {},
): SafeError {
  const knownSafeError = isSafeErrorLike(error) ? error : undefined;
  const known = knownSafeError ?? fallback;
  const safeMessage = redact(known.message).value;
  return SafeErrorSchema.parse({
    tag: known.tag,
    code: known.code,
    message: safeMessage,
    ...(known.hint === undefined ? {} : { hint: redact(known.hint).value }),
    ...(known.provider === undefined ? {} : { provider: known.provider }),
    ...(knownSafeError?.projectId === undefined ? {} : { projectId: knownSafeError.projectId }),
    ...(knownSafeError?.worktreeId === undefined ? {} : { worktreeId: knownSafeError.worktreeId }),
    ...(knownSafeError?.sessionId === undefined ? {} : { sessionId: knownSafeError.sessionId }),
    ...(knownSafeError?.diagnosticId === undefined
      ? {}
      : { diagnosticId: knownSafeError.diagnosticId }),
    ...context,
  });
}

export function createErrorEnvelope(input: ErrorEnvelopeInput): ErrorEnvelope {
  const safeError = toSafeError(input.error, input.fallback, {
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
  });
  const errorObject = input.error instanceof Error ? input.error : undefined;
  const provider = input.provider ?? safeError.provider;
  const redactedCause = redact(errorObject?.message ?? input.error).value;
  const redactedStack =
    errorObject?.stack === undefined ? undefined : redact(errorObject.stack).value;
  const redactedRaw = input.raw === undefined ? undefined : redact(input.raw).value;

  return ErrorEnvelopeSchema.parse({
    id: input.id,
    tag: safeError.tag,
    code: safeError.code,
    message: typeof redactedCause === "string" ? redactedCause : safeError.message,
    severity: input.severity ?? "error",
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    ...(input.spanId === undefined ? {} : { spanId: input.spanId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(provider === undefined ? {} : { provider }),
    ...(redactedCause === undefined ? {} : { cause: redactedCause }),
    ...(redactedStack === undefined ? {} : { stack: redactedStack }),
    ...(redactedRaw === undefined ? {} : { raw: redactedRaw }),
    redacted: true,
    createdAt: input.createdAt,
  });
}

function isSafeErrorLike(value: unknown): value is SafeError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SafeError>;
  return (
    typeof candidate.tag === "string" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}
