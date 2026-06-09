import { access as defaultAccess } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { SafeError } from "@wosm/contracts";
import { type ExternalCommandRunner, runExternalCommand } from "@wosm/runtime";

export type TmuxDependencyStatus =
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

export type CheckTmuxDependencyOptions = {
  command?: string;
  timeoutMs?: number;
  runner?: ExternalCommandRunner;
  pathEnv?: string;
  access?: (path: string) => Promise<void>;
};

export const defaultTmuxCommand = "tmux";

export function tmuxInstallHint(command = defaultTmuxCommand): string {
  return [
    "Install tmux with brew install tmux.",
    `wosm tried ${command}.`,
    "Set terminal.tmux.command or WOSM_TMUX_BIN if the binary lives elsewhere.",
  ].join(" ");
}

export async function checkTmuxDependency(
  options: CheckTmuxDependencyOptions = {},
): Promise<TmuxDependencyStatus> {
  const attemptedCommand = options.command ?? process.env.WOSM_TMUX_BIN ?? defaultTmuxCommand;
  const installHint = tmuxInstallHint(attemptedCommand);
  const resolveOptions: Pick<CheckTmuxDependencyOptions, "access" | "pathEnv"> = {};
  if (options.pathEnv !== undefined) resolveOptions.pathEnv = options.pathEnv;
  if (options.access !== undefined) resolveOptions.access = options.access;
  const resolvedPath = await resolveExecutablePath(attemptedCommand, resolveOptions);

  try {
    const output = await runExternalCommand(
      {
        command: attemptedCommand,
        args: ["-V"],
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        maxOutputChars: 4096,
      },
      options.runner,
    );
    const rawVersion = `${output.stdout}${output.stderr}`.trim();
    const status: TmuxDependencyStatus = {
      status: "available",
      attemptedCommand,
      installHint,
    };
    if (resolvedPath !== undefined) status.resolvedPath = resolvedPath;
    if (rawVersion.length > 0) status.rawVersion = rawVersion;
    const version = parseTmuxVersion(rawVersion);
    if (version !== undefined) status.version = version;
    return status;
  } catch {
    const status: TmuxDependencyStatus = {
      status: "unavailable",
      attemptedCommand,
      installHint,
      error: {
        tag: "ProviderUnavailableError",
        code: "TMUX_UNAVAILABLE",
        message: "tmux is not available.",
        hint: installHint,
        provider: "tmux",
      },
    };
    if (resolvedPath !== undefined) status.resolvedPath = resolvedPath;
    return status;
  }
}

export function parseTmuxVersion(output: string): string | undefined {
  return output.match(/\btmux\s+([0-9A-Za-z][0-9A-Za-z.+-]*)\b/)?.[1];
}

async function resolveExecutablePath(
  command: string,
  options: Pick<CheckTmuxDependencyOptions, "access" | "pathEnv">,
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
