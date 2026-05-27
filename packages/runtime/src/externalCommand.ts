import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runRuntimeBoundary, runRuntimeBoundaryWithTimeout } from "./boundary.js";
import {
  type ExternalCommandError,
  isSafeError,
  type RuntimeSafeError,
  type RuntimeSafeErrorFallback,
  safeErrorFromUnknown,
} from "./errors.js";

const execFileAsync = promisify(execFile);
const outputSnippetMaxChars = 2000;
const redactedValue = "[REDACTED]";
const redactedSecret = "[REDACTED_SECRET]";

const secretAssignmentKeyPattern =
  /(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|auth|credential|private[-_]?key)/i;

export type ExternalCommandResult = {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ExternalCommandRunner = (input: ExternalCommandInput) => Promise<ExternalCommandResult>;

export type ExternalCommandInput = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputChars?: number;
  signal?: AbortSignal;
  allowedExitCodes?: number[];
};

export async function runExternalCommand(
  input: ExternalCommandInput,
  runner: ExternalCommandRunner = nodeExternalCommandRunner,
): Promise<ExternalCommandResult> {
  const task = async ({ signal }: { signal: AbortSignal }) => {
    // Merge caller cancellation with the runtime timeout signal so execFile aborts on either.
    const linked = linkAbortSignals(input.signal, signal);
    try {
      try {
        return await runner({
          ...input,
          ...(linked.signal === undefined ? {} : { signal: linked.signal }),
        });
      } catch (error) {
        const allowedResult = allowedExitCodeResultFromUnknown(error, input);
        if (allowedResult !== undefined) {
          return allowedResult;
        }
        throw externalCommandErrorFromUnknown(error, input);
      }
    } finally {
      linked.cleanup();
    }
  };

  const result =
    input.timeoutMs === undefined
      ? await runRuntimeBoundary(
          {
            operation: `externalCommand.${input.command}`,
            error: externalCommandFallback("EXTERNAL_COMMAND_FAILED", "External command failed."),
          },
          task,
        )
      : await runRuntimeBoundaryWithTimeout(
          {
            operation: `externalCommand.${input.command}`,
            timeoutMs: input.timeoutMs,
            error: externalCommandFallback("EXTERNAL_COMMAND_FAILED", "External command failed."),
            timeoutError: externalCommandFallback(
              "EXTERNAL_COMMAND_TIMEOUT",
              "External command timed out.",
            ),
          },
          task,
        );

  if (result.ok) {
    return result.value;
  }

  throw externalCommandErrorFromUnknown(result.error, input);
}

export async function nodeExternalCommandRunner(
  input: ExternalCommandInput,
): Promise<ExternalCommandResult> {
  const args = input.args ?? [];
  const result = await execFileAsync(input.command, args, {
    cwd: input.cwd,
    env: input.env === undefined ? process.env : { ...process.env, ...input.env },
    maxBuffer: input.maxOutputChars ?? 64 * 1024,
    signal: input.signal,
  });
  return {
    command: input.command,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: 0,
  };
}

export function createFakeExternalCommandRunner(
  handler: (input: ExternalCommandInput) => ExternalCommandResult | Promise<ExternalCommandResult>,
): ExternalCommandRunner {
  return async (input) => handler(input);
}

export function externalCommandErrorFromUnknown(
  error: unknown,
  input: Pick<ExternalCommandInput, "command" | "args" | "cwd">,
): ExternalCommandError {
  const fallback = externalCommandFallback("EXTERNAL_COMMAND_FAILED", "External command failed.");
  const safeError = safeErrorFromUnknown(error, fallback);
  const cause = isRecord(error) ? error : {};
  const normalized: ExternalCommandError = {
    tag: "ExternalCommandError",
    code: externalCommandCode(error, cause, safeError),
    message: externalCommandMessage(error, safeError),
    command: formatCommandForError(input),
  };

  copySafeErrorContext(normalized, safeError);

  if (input.cwd !== undefined) {
    normalized.cwd = input.cwd;
  }

  const exitCode = numericField(cause, "exitCode") ?? numericField(cause, "code");
  if (exitCode !== undefined) {
    normalized.exitCode = exitCode;
  }

  const signal = stringField(cause, "signal");
  if (signal !== undefined) {
    normalized.signal = signal;
  }

  const stdoutSnippet = outputSnippet(cause, "stdout", "stdoutSnippet");
  if (stdoutSnippet !== undefined) {
    normalized.stdoutSnippet = stdoutSnippet;
  }

  const stderrSnippet = outputSnippet(cause, "stderr", "stderrSnippet");
  if (stderrSnippet !== undefined) {
    normalized.stderrSnippet = stderrSnippet;
  }

  normalized.diagnosticDetails = [externalCommandDiagnosticDetail(normalized)];

  return normalized;
}

function externalCommandFallback(code: string, message: string): RuntimeSafeErrorFallback {
  return {
    tag: "ExternalCommandError",
    code,
    message,
  };
}

function externalCommandCode(
  error: unknown,
  cause: Record<string, unknown>,
  safeError: RuntimeSafeError,
): string {
  if (isAbortLikeError(error)) {
    return "EXTERNAL_COMMAND_ABORTED";
  }
  return stringField(cause, "code") ?? safeError.code;
}

function externalCommandMessage(error: unknown, safeError: RuntimeSafeError): string {
  return isAbortLikeError(error) ? "External command was aborted." : safeError.message;
}

function formatCommandForError(input: Pick<ExternalCommandInput, "command" | "args">): string {
  const parts = [input.command, ...(input.args ?? [])];
  const redacted: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const previous = parts[index - 1];
    const part = parts[index] ?? "";
    if (previous !== undefined && !previous.includes("=") && isSecretFlag(previous)) {
      redacted.push(redactedValue);
      continue;
    }
    redacted.push(redactCommandPart(part));
  }

  return redacted.join(" ");
}

function numericField(
  record: Record<string, unknown>,
  key: "exitCode" | "code",
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function outputSnippet(
  cause: Record<string, unknown>,
  rawKey: "stdout" | "stderr",
  snippetKey: "stdoutSnippet" | "stderrSnippet",
): string | undefined {
  const value = stringField(cause, rawKey) ?? stringField(cause, snippetKey);
  if (value === undefined) {
    return undefined;
  }
  const redacted = redactCommandOutput(value).slice(0, outputSnippetMaxChars);
  return redacted.length === 0 ? undefined : redacted;
}

function allowedExitCodeResultFromUnknown(
  error: unknown,
  input: Pick<ExternalCommandInput, "allowedExitCodes" | "args" | "command">,
): ExternalCommandResult | undefined {
  if (isAbortLikeError(error)) {
    return undefined;
  }
  if (!isRecord(error)) {
    return undefined;
  }

  const exitCode = numericField(error, "exitCode") ?? numericField(error, "code");
  if (exitCode === undefined || input.allowedExitCodes?.includes(exitCode) !== true) {
    return undefined;
  }

  return {
    command: input.command,
    args: input.args ?? [],
    stdout: stringField(error, "stdout") ?? "",
    stderr: stringField(error, "stderr") ?? "",
    exitCode,
  };
}

function copySafeErrorContext(target: ExternalCommandError, safeError: RuntimeSafeError): void {
  if (safeError.hint !== undefined) target.hint = safeError.hint;
  if (safeError.commandId !== undefined) target.commandId = safeError.commandId;
  if (safeError.projectId !== undefined) target.projectId = safeError.projectId;
  if (safeError.worktreeId !== undefined) target.worktreeId = safeError.worktreeId;
  if (safeError.sessionId !== undefined) target.sessionId = safeError.sessionId;
  if (safeError.provider !== undefined) target.provider = safeError.provider;
  if (safeError.traceId !== undefined) target.traceId = safeError.traceId;
  if (safeError.diagnosticId !== undefined) target.diagnosticId = safeError.diagnosticId;
}

function externalCommandDiagnosticDetail(error: ExternalCommandError) {
  const detail: NonNullable<RuntimeSafeError["diagnosticDetails"]>[number] = {
    type: "external_command",
    operation: `externalCommand.${error.command.split(" ")[0] ?? "command"}`,
    command: error.command,
  };
  if (error.provider !== undefined) detail.provider = error.provider;
  if (error.cwd !== undefined) detail.cwd = error.cwd;
  if (error.exitCode !== undefined) detail.exitCode = error.exitCode;
  if (error.signal !== undefined) detail.signal = error.signal;
  if (error.stdoutSnippet !== undefined) detail.stdoutSnippet = error.stdoutSnippet;
  if (error.stderrSnippet !== undefined) detail.stderrSnippet = error.stderrSnippet;
  return detail;
}

function redactCommandPart(value: string): string {
  const assignment = value.match(/^([^=]+)=(.*)$/);
  if (assignment !== null) {
    const key = assignment[1] ?? "";
    if (isSecretAssignmentKey(key)) {
      return `${key}=${redactedValue}`;
    }
  }
  return redactCommandOutput(value);
}

function isSecretFlag(value: string): boolean {
  const key = value.split("=")[0] ?? value;
  return key.startsWith("-") && isSecretAssignmentKey(key);
}

function isSecretAssignmentKey(value: string): boolean {
  return secretAssignmentKeyPattern.test(value);
}

function linkAbortSignals(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal | undefined;
  cleanup(): void;
} {
  // Reuse a single source signal when possible; allocate a controller only to merge sources.
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (activeSignals.length === 0) {
    return { signal: undefined, cleanup: () => undefined };
  }
  if (activeSignals.length === 1) {
    return { signal: activeSignals[0], cleanup: () => undefined };
  }

  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      continue;
    }
    const listener = () => abort(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push(() => signal.removeEventListener("abort", listener));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function isAbortLikeError(error: unknown): boolean {
  if (isSafeError(error)) {
    return error.tag === "CancellationError" || error.code === "EXTERNAL_COMMAND_ABORTED";
  }
  if (!isRecord(error)) {
    return false;
  }
  return error.name === "AbortError" || error.code === "ABORT_ERR";
}

export function redactCommandOutput(value: string): string {
  return value
    .replace(
      /([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Za-z0-9_]*)=([^\s]+)/gi,
      `$1=${redactedValue}`,
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${redactedValue}`)
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|sk_[A-Za-z0-9_]{8,}|ghp_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g,
      redactedSecret,
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
