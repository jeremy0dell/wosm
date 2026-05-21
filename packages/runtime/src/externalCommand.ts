import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runRuntimeBoundary, runRuntimeBoundaryWithTimeout } from "./boundary.js";
import {
  type ExternalCommandError,
  isSafeError,
  type RuntimeSafeErrorFallback,
  safeErrorFromUnknown,
} from "./errors.js";

const execFileAsync = promisify(execFile);

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
};

export async function runExternalCommand(
  input: ExternalCommandInput,
  runner: ExternalCommandRunner = nodeExternalCommandRunner,
): Promise<ExternalCommandResult> {
  const task = async ({ signal }: { signal: AbortSignal }) => {
    const linked = linkAbortSignals(input.signal, signal);
    try {
      try {
        return await runner({
          ...input,
          ...(linked.signal === undefined ? {} : { signal: linked.signal }),
        });
      } catch (error) {
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
  input: Pick<ExternalCommandInput, "command" | "args">,
): ExternalCommandError {
  const fallback = externalCommandFallback("EXTERNAL_COMMAND_FAILED", "External command failed.");
  const safeError = safeErrorFromUnknown(error, fallback);
  const cause = isRecord(error) ? error : {};
  const abortLike = isAbortLikeError(error);
  return {
    tag: "ExternalCommandError",
    code: abortLike
      ? "EXTERNAL_COMMAND_ABORTED"
      : typeof cause.code === "string"
        ? cause.code
        : safeError.code,
    message: abortLike ? "External command was aborted." : safeError.message,
    command: [input.command, ...(input.args ?? [])].join(" "),
    ...(typeof cause.code === "number" ? { exitCode: cause.code } : {}),
    ...(typeof cause.signal === "string" ? { signal: cause.signal } : {}),
    ...(typeof cause.stdout === "string"
      ? { stdoutSnippet: redactCommandOutput(cause.stdout).slice(0, 2000) }
      : typeof cause.stdoutSnippet === "string"
        ? { stdoutSnippet: redactCommandOutput(cause.stdoutSnippet).slice(0, 2000) }
        : {}),
    ...(typeof cause.stderr === "string"
      ? { stderrSnippet: redactCommandOutput(cause.stderr).slice(0, 2000) }
      : typeof cause.stderrSnippet === "string"
        ? { stderrSnippet: redactCommandOutput(cause.stderrSnippet).slice(0, 2000) }
        : {}),
  };
}

function externalCommandFallback(code: string, message: string): RuntimeSafeErrorFallback {
  return {
    tag: "ExternalCommandError",
    code,
    message,
  };
}

function linkAbortSignals(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal | undefined;
  cleanup(): void;
} {
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
      "$1=[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:sk|ghp|github_pat)_[A-Za-z0-9_]{8,}/g, "[REDACTED_SECRET]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
