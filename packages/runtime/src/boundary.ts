import { Effect } from "./effect.js";
import {
  type RuntimeSafeError,
  type RuntimeSafeErrorFallback,
  safeErrorFromUnknown,
} from "./errors.js";

export type RuntimeClock = {
  now(): Date;
};

export type RuntimeTraceContext = {
  traceId?: string;
  spanId?: string;
  operation?: string;
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
      traceId?: string;
      spanId?: string;
    }
  | {
      ok: false;
      error: RuntimeSafeError;
      timing: RuntimeBoundaryTiming;
      traceId?: string;
      spanId?: string;
    };

export type RuntimeTimeoutOptions = {
  timeoutMs: number;
  error: RuntimeSafeErrorFallback;
};

export type RuntimeRetryOptions = {
  retries: number;
  delayMs?: number;
  shouldRetry?: (error: RuntimeSafeError, attempt: number) => boolean;
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
    clock?: RuntimeClock | undefined;
    error: RuntimeSafeErrorFallback;
    trace?: RuntimeTraceContext | undefined;
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
          error: withTrace(error, input.trace),
        }),
    ),
  );
  const finishedAt = toIsoTimestamp(clock.now());
  const timing = {
    operation: input.operation,
    startedAt,
    finishedAt,
    durationMs: durationMs(startedAt, finishedAt),
  };
  const traceFields = traceFieldsFromContext(input.trace);

  if (result.ok) {
    return {
      ok: true,
      value: result.value,
      timing,
      ...traceFields,
    };
  }

  return {
    ok: false,
    error: result.error,
    timing,
    ...traceFields,
  };
}

export function runtimeBoundaryWithTimeoutEffect<T>(
  input: RuntimeTimeoutOptions,
  task: () => Promise<T>,
): Effect.Effect<T, RuntimeSafeError> {
  return runtimeBoundaryEffect(input, () => withTimeout(task, input));
}

export async function runRuntimeBoundaryWithTimeout<T>(
  input: {
    operation: string;
    clock?: RuntimeClock | undefined;
    timeoutMs: number;
    error: RuntimeSafeErrorFallback;
    trace?: RuntimeTraceContext | undefined;
  },
  task: () => Promise<T>,
): Promise<RuntimeBoundaryResult<T>> {
  return runRuntimeBoundary(input, () => withTimeout(task, input));
}

export async function runRuntimeBoundaryWithRetry<T>(
  input: {
    operation: string;
    clock?: RuntimeClock | undefined;
    error: RuntimeSafeErrorFallback;
    retry: RuntimeRetryOptions;
    trace?: RuntimeTraceContext | undefined;
  },
  task: () => Promise<T>,
): Promise<RuntimeBoundaryResult<T>> {
  return runRuntimeBoundary(input, () => withRetry(input.retry, input.error, task));
}

export async function withRetry<T>(
  retry: RuntimeRetryOptions,
  fallback: RuntimeSafeErrorFallback,
  task: () => Promise<T>,
): Promise<T> {
  let attempt = 0;
  let lastError: RuntimeSafeError | undefined;

  while (attempt <= retry.retries) {
    try {
      return await task();
    } catch (error) {
      const safeError = safeErrorFromUnknown(error, fallback);
      lastError = safeError;
      const shouldRetry = retry.shouldRetry?.(safeError, attempt) ?? attempt < retry.retries;
      if (!shouldRetry || attempt >= retry.retries) {
        throw safeError;
      }
      attempt += 1;
      if (retry.delayMs !== undefined && retry.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retry.delayMs));
      }
    }
  }

  throw lastError ?? safeErrorFromUnknown(undefined, fallback);
}

export async function withTimeout<T>(
  task: () => Promise<T>,
  input: RuntimeTimeoutOptions,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(safeErrorFromUnknown(input.error, input.error)),
          input.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function withTrace(
  error: RuntimeSafeError,
  trace: RuntimeTraceContext | undefined,
): RuntimeSafeError {
  if (trace?.traceId === undefined || error.traceId !== undefined) {
    return error;
  }
  return {
    ...error,
    traceId: trace.traceId,
  };
}

function traceFieldsFromContext(trace: RuntimeTraceContext | undefined): {
  traceId?: string;
  spanId?: string;
} {
  return {
    ...(trace?.traceId === undefined ? {} : { traceId: trace.traceId }),
    ...(trace?.spanId === undefined ? {} : { spanId: trace.spanId }),
  };
}
