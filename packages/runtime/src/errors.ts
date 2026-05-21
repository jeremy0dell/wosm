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
  hint?: string | undefined;
  provider?: string | undefined;
  traceId?: string | undefined;
};

export type RuntimeTimeoutError = RuntimeSafeError & {
  tag: "TimeoutError";
};

export type RuntimeCancellationError = RuntimeSafeError & {
  tag: "CancellationError";
};

export type ExternalCommandError = RuntimeSafeError & {
  tag: "ExternalCommandError";
  command: string;
  exitCode?: number;
  signal?: string;
  stdoutSnippet?: string;
  stderrSnippet?: string;
};

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
  if (fallback.traceId !== undefined) {
    safeError.traceId = fallback.traceId;
  }

  return safeError;
}
