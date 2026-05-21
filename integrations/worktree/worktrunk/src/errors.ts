import type { SafeError } from "@wosm/contracts";
import { safeErrorFromUnknown } from "@wosm/runtime";

export type WorktrunkProviderErrorCode =
  | "WORKTRUNK_COMMAND_FAILED"
  | "WORKTRUNK_INVALID_OUTPUT"
  | "WORKTRUNK_UNAVAILABLE"
  | "WORKTRUNK_WORKTREE_NOT_FOUND";

export class WorktrunkProviderError extends Error implements SafeError {
  readonly tag = "WorktreeProviderError";
  readonly provider = "worktrunk";
  readonly code: WorktrunkProviderErrorCode;
  readonly hint?: string;

  constructor(
    code: WorktrunkProviderErrorCode,
    message: string,
    options: { hint?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    Object.defineProperty(this, "name", {
      value: this.tag,
      enumerable: false,
      configurable: true,
    });
    this.code = code;
    if (options.hint !== undefined) {
      this.hint = options.hint;
    }
  }
}

export class ProviderUnavailableError extends Error implements SafeError {
  readonly tag = "ProviderUnavailableError";
  readonly provider = "worktrunk";
  readonly code = "WORKTRUNK_UNAVAILABLE";
  readonly hint?: string;

  constructor(
    message = "Worktrunk is not available.",
    options: { hint?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    Object.defineProperty(this, "name", {
      value: this.tag,
      enumerable: false,
      configurable: true,
    });
    if (options.hint !== undefined) {
      this.hint = options.hint;
    }
  }
}

export function worktrunkSafeError(
  error: unknown,
  fallback: {
    code: WorktrunkProviderErrorCode;
    message: string;
    hint?: string;
  },
): SafeError {
  return safeErrorFromUnknown(error, {
    tag:
      fallback.code === "WORKTRUNK_UNAVAILABLE"
        ? "ProviderUnavailableError"
        : "WorktreeProviderError",
    code: fallback.code,
    message: fallback.message,
    provider: "worktrunk",
    ...(fallback.hint === undefined ? {} : { hint: fallback.hint }),
  });
}

export function providerErrorFromUnknown(
  error: unknown,
  fallback: {
    code: WorktrunkProviderErrorCode;
    message: string;
    hint?: string;
  },
): WorktrunkProviderError | ProviderUnavailableError {
  const safeError = worktrunkSafeError(error, fallback);
  const hint = safeError.hint ?? fallback.hint;
  if (safeError.tag === "ProviderUnavailableError" || fallback.code === "WORKTRUNK_UNAVAILABLE") {
    return new ProviderUnavailableError(safeError.message, {
      cause: error,
      ...(hint === undefined ? {} : { hint }),
    });
  }

  return new WorktrunkProviderError(fallback.code, safeError.message, {
    cause: error,
    ...(hint === undefined ? {} : { hint }),
  });
}
