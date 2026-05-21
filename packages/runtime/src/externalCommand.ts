import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type ExternalCommandError,
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
};

export async function runExternalCommand(
  input: ExternalCommandInput,
  runner: ExternalCommandRunner = nodeExternalCommandRunner,
): Promise<ExternalCommandResult> {
  try {
    return await runner(input);
  } catch (error) {
    throw externalCommandErrorFromUnknown(error, input);
  }
}

export async function nodeExternalCommandRunner(
  input: ExternalCommandInput,
): Promise<ExternalCommandResult> {
  const args = input.args ?? [];
  const result = await execFileAsync(input.command, args, {
    cwd: input.cwd,
    env: input.env === undefined ? process.env : { ...process.env, ...input.env },
    timeout: input.timeoutMs,
    maxBuffer: input.maxOutputChars ?? 64 * 1024,
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
  const fallback: RuntimeSafeErrorFallback = {
    tag: "ExternalCommandError",
    code: "EXTERNAL_COMMAND_FAILED",
    message: "External command failed.",
  };
  const safeError = safeErrorFromUnknown(error, fallback);
  const cause = isRecord(error) ? error : {};
  return {
    tag: "ExternalCommandError",
    code: typeof cause.code === "string" ? cause.code : safeError.code,
    message: safeError.message,
    command: [input.command, ...(input.args ?? [])].join(" "),
    ...(typeof cause.code === "number" ? { exitCode: cause.code } : {}),
    ...(typeof cause.signal === "string" ? { signal: cause.signal } : {}),
    ...(typeof cause.stdout === "string"
      ? { stdoutSnippet: redactCommandOutput(cause.stdout).slice(0, 2000) }
      : {}),
    ...(typeof cause.stderr === "string"
      ? { stderrSnippet: redactCommandOutput(cause.stderr).slice(0, 2000) }
      : {}),
  };
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
