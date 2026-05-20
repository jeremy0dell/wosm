export {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Logger,
  Queue,
  Schedule,
  Scope,
} from "effect";

import { Effect } from "effect";

export type RuntimeClock = {
  now(): Date;
};

export type RuntimeBoundaryTiming = {
  operation: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type RuntimeBoundaryResult<T> =
  | {
      ok: true;
      value: T;
      timing: RuntimeBoundaryTiming;
    }
  | {
      ok: false;
      error: RuntimeSafeError;
      timing: RuntimeBoundaryTiming;
    };

export type RuntimeSafeError = {
  tag: string;
  code: string;
  message: string;
  hint?: string;
  commandId?: string;
  projectId?: string;
  worktreeId?: string;
  sessionId?: string;
  provider?: string;
  traceId?: string;
  diagnosticId?: string;
};

export type RuntimeSafeErrorFallback = {
  tag: string;
  code: string;
  message: string;
  hint?: string;
  provider?: string;
};

export const systemClock: RuntimeClock = {
  now: () => new Date(),
};

export function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function durationMs(startedAt: string, finishedAt: string): number {
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

export function isSafeError(value: unknown): value is RuntimeSafeError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RuntimeSafeError>;
  return (
    typeof candidate.tag === "string" &&
    candidate.tag.length > 0 &&
    typeof candidate.code === "string" &&
    candidate.code.length > 0 &&
    typeof candidate.message === "string" &&
    candidate.message.length > 0
  );
}

export function safeErrorFromUnknown(
  error: unknown,
  fallback: RuntimeSafeErrorFallback,
): RuntimeSafeError {
  if (isSafeError(error)) {
    return error;
  }

  const safeError: RuntimeSafeError = {
    tag: fallback.tag,
    code: fallback.code,
    message: fallback.message,
  };

  if (fallback.hint !== undefined) {
    safeError.hint = fallback.hint;
  }
  if (fallback.provider !== undefined) {
    safeError.provider = fallback.provider;
  }

  return safeError;
}

export function runtimeBoundaryEffect<T>(
  input: {
    error: RuntimeSafeErrorFallback;
  },
  task: () => Promise<T>,
): Effect.Effect<T, RuntimeSafeError> {
  return Effect.tryPromise({
    try: task,
    catch: (error) => safeErrorFromUnknown(error, input.error),
  });
}

export async function runRuntimeBoundary<T>(
  input: {
    operation: string;
    clock?: RuntimeClock;
    error: RuntimeSafeErrorFallback;
  },
  task: () => Promise<T>,
): Promise<RuntimeBoundaryResult<T>> {
  const clock = input.clock ?? systemClock;
  const startedAt = toIsoTimestamp(clock.now());
  const result = await Effect.runPromise(
    Effect.catchAll(
      Effect.map(runtimeBoundaryEffect(input, task), (value) => ({
        ok: true as const,
        value,
      })),
      (error) =>
        Effect.succeed({
          ok: false as const,
          error,
        }),
    ),
  );
  const finishedAt = toIsoTimestamp(clock.now());

  if (result.ok) {
    return {
      ok: true,
      value: result.value,
      timing: {
        operation: input.operation,
        startedAt,
        finishedAt,
        durationMs: durationMs(startedAt, finishedAt),
      },
    };
  }

  return {
    ok: false,
    error: result.error,
    timing: {
      operation: input.operation,
      startedAt,
      finishedAt,
      durationMs: durationMs(startedAt, finishedAt),
    },
  };
}
