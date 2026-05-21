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
  const safeError: SafeError = {
    tag: known.tag,
    code: known.code,
    message: safeMessage,
  };
  if (known.hint !== undefined) safeError.hint = redact(known.hint).value;
  if (known.provider !== undefined) safeError.provider = known.provider;
  if (knownSafeError?.projectId !== undefined) safeError.projectId = knownSafeError.projectId;
  if (knownSafeError?.worktreeId !== undefined) safeError.worktreeId = knownSafeError.worktreeId;
  if (knownSafeError?.sessionId !== undefined) safeError.sessionId = knownSafeError.sessionId;
  if (knownSafeError?.diagnosticId !== undefined) {
    safeError.diagnosticId = knownSafeError.diagnosticId;
  }
  applySafeErrorContext(safeError, context);
  return SafeErrorSchema.parse(safeError);
}

export function createErrorEnvelope(input: ErrorEnvelopeInput): ErrorEnvelope {
  const context: Partial<
    Pick<
      SafeError,
      "commandId" | "projectId" | "worktreeId" | "sessionId" | "traceId" | "diagnosticId"
    >
  > = {};
  if (input.commandId !== undefined) context.commandId = input.commandId;
  if (input.projectId !== undefined) context.projectId = input.projectId;
  if (input.worktreeId !== undefined) context.worktreeId = input.worktreeId;
  if (input.sessionId !== undefined) context.sessionId = input.sessionId;
  if (input.traceId !== undefined) context.traceId = input.traceId;

  const safeError = toSafeError(input.error, input.fallback, context);
  const errorObject = input.error instanceof Error ? input.error : undefined;
  const provider = input.provider ?? safeError.provider;
  const redactedCause = redact(errorObject?.message ?? input.error).value;
  const redactedStack =
    errorObject?.stack === undefined ? undefined : redact(errorObject.stack).value;
  const redactedRaw = input.raw === undefined ? undefined : redact(input.raw).value;

  const envelope: ErrorEnvelope = {
    id: input.id,
    tag: safeError.tag,
    code: safeError.code,
    message: typeof redactedCause === "string" ? redactedCause : safeError.message,
    severity: input.severity ?? "error",
    redacted: true,
    createdAt: input.createdAt,
  };
  if (input.commandId !== undefined) envelope.commandId = input.commandId;
  if (input.traceId !== undefined) envelope.traceId = input.traceId;
  if (input.spanId !== undefined) envelope.spanId = input.spanId;
  if (input.projectId !== undefined) envelope.projectId = input.projectId;
  if (input.worktreeId !== undefined) envelope.worktreeId = input.worktreeId;
  if (input.sessionId !== undefined) envelope.sessionId = input.sessionId;
  if (provider !== undefined) envelope.provider = provider;
  if (redactedCause !== undefined) envelope.cause = redactedCause;
  if (redactedStack !== undefined) envelope.stack = redactedStack;
  if (redactedRaw !== undefined) envelope.raw = redactedRaw;

  return ErrorEnvelopeSchema.parse(envelope);
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

function applySafeErrorContext(
  target: SafeError,
  context: Partial<
    Pick<
      SafeError,
      "commandId" | "projectId" | "worktreeId" | "sessionId" | "traceId" | "diagnosticId"
    >
  >,
): void {
  if (context.commandId !== undefined) target.commandId = context.commandId;
  if (context.projectId !== undefined) target.projectId = context.projectId;
  if (context.worktreeId !== undefined) target.worktreeId = context.worktreeId;
  if (context.sessionId !== undefined) target.sessionId = context.sessionId;
  if (context.traceId !== undefined) target.traceId = context.traceId;
  if (context.diagnosticId !== undefined) target.diagnosticId = context.diagnosticId;
}
