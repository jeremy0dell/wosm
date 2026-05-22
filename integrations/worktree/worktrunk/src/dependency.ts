import { access as defaultAccess } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { SafeError } from "@wosm/contracts";
import {
  type ExternalCommandRunner,
  runExternalCommand,
  safeErrorFromUnknown,
} from "@wosm/runtime";
import { ProviderUnavailableError } from "./errors.js";

export type WorktrunkDependencyStatus =
  | {
      status: "available";
      attemptedCommand: string;
      installHint: string;
      resolvedPath?: string;
      version?: string;
      rawVersion?: string;
    }
  | {
      status: "unavailable";
      attemptedCommand: string;
      installHint: string;
      resolvedPath?: string;
      error: SafeError;
    };

export type CheckWorktrunkDependencyOptions = {
  command?: string;
  timeoutMs?: number;
  runner?: ExternalCommandRunner;
  pathEnv?: string;
  access?: (path: string) => Promise<void>;
};

export const defaultWorktrunkCommand = "wt";

export function worktrunkInstallHint(command = defaultWorktrunkCommand): string {
  return [
    "Install Worktrunk with brew install worktrunk && wt config shell install.",
    `wosm tried ${command}.`,
    "Set worktree.worktrunk.command or WOSM_WORKTRUNK_BIN if the binary lives elsewhere.",
  ].join(" ");
}

export async function checkWorktrunkDependency(
  options: CheckWorktrunkDependencyOptions = {},
): Promise<WorktrunkDependencyStatus> {
  const attemptedCommand =
    options.command ?? process.env.WOSM_WORKTRUNK_BIN ?? defaultWorktrunkCommand;
  const installHint = worktrunkInstallHint(attemptedCommand);
  const resolveOptions: Pick<CheckWorktrunkDependencyOptions, "access" | "pathEnv"> = {};
  if (options.pathEnv !== undefined) resolveOptions.pathEnv = options.pathEnv;
  if (options.access !== undefined) resolveOptions.access = options.access;
  const resolvedPath = await resolveExecutablePath(attemptedCommand, resolveOptions);

  try {
    const output = await runExternalCommand(
      {
        command: attemptedCommand,
        args: ["--version"],
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        maxOutputChars: 4096,
      },
      options.runner,
    );
    const rawVersion = `${output.stdout}${output.stderr}`.trim();
    const status: WorktrunkDependencyStatus = {
      status: "available",
      attemptedCommand,
      installHint,
    };
    if (resolvedPath !== undefined) status.resolvedPath = resolvedPath;
    if (rawVersion.length > 0) status.rawVersion = rawVersion;
    const version = parseWorktrunkVersion(rawVersion);
    if (version !== undefined) status.version = version;
    return status;
  } catch (cause) {
    const error = new ProviderUnavailableError("Worktrunk is not available.", {
      hint: installHint,
      command: attemptedCommand,
      installHint,
      cause,
    });
    const status: WorktrunkDependencyStatus = {
      status: "unavailable",
      attemptedCommand,
      installHint,
      error: safeErrorFromUnknown(error, {
        tag: "ProviderUnavailableError",
        code: "WORKTRUNK_UNAVAILABLE",
        message: "Worktrunk is not available.",
        hint: installHint,
        provider: "worktrunk",
      }),
    };
    if (resolvedPath !== undefined) status.resolvedPath = resolvedPath;
    return status;
  }
}

export function parseWorktrunkVersion(output: string): string | undefined {
  return output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/)?.[1];
}

async function resolveExecutablePath(
  command: string,
  options: Pick<CheckWorktrunkDependencyOptions, "access" | "pathEnv">,
): Promise<string | undefined> {
  const access = options.access ?? defaultAccess;
  if (isPathLikeCommand(command)) {
    return (await canAccess(command, access)) ? command : undefined;
  }

  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  for (const directory of pathEnv.split(delimiter).filter((part) => part.length > 0)) {
    const candidate = join(directory, command);
    if (await canAccess(candidate, access)) {
      return candidate;
    }
  }
  return undefined;
}

async function canAccess(path: string, access: (path: string) => Promise<void>): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isPathLikeCommand(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}
