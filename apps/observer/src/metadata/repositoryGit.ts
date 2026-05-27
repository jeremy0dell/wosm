import { normalize } from "node:path";
import type { RepositoryRemote } from "@wosm/contracts";
import {
  type ExternalCommandRunner,
  type RuntimeClock,
  runExternalCommand,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";

export type RepositoryGitWorktree = {
  id: string;
  projectId: string;
  path: string;
  branch: string;
  state?: string;
};

export type RepositoryGitContext = {
  worktreeId: string;
  projectId: string;
  path: string;
  branch: string;
  headSha: string;
  remoteName: string;
  remote: RepositoryRemote;
  checkedAt: string;
};

export type ReadRepositoryGitContextInput = {
  worktree: RepositoryGitWorktree;
  timeoutMs?: number;
  clock?: RuntimeClock;
  runner?: ExternalCommandRunner;
  signal?: AbortSignal;
};

type GitCommandContext = {
  cwd: string;
  timeoutMs: number;
  runner?: ExternalCommandRunner;
  signal?: AbortSignal;
};

const defaultGitTimeoutMs = 200;

export async function readRepositoryGitContext(
  input: ReadRepositoryGitContextInput,
): Promise<RepositoryGitContext | undefined> {
  if (input.worktree.state !== undefined && input.worktree.state !== "exists") {
    return undefined;
  }

  const command: GitCommandContext = {
    cwd: input.worktree.path,
    timeoutMs: input.timeoutMs ?? defaultGitTimeoutMs,
  };
  if (input.runner !== undefined) command.runner = input.runner;
  if (input.signal !== undefined) command.signal = input.signal;

  const headSha = (await runGit(command, ["rev-parse", "--verify", "HEAD^{commit}"])).stdout.trim();
  const remotes = (await runOptionalGit(command, ["remote"]))?.stdout
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter((remote) => remote.length > 0);
  const remoteName = remotes?.includes("origin") === true ? "origin" : remotes?.[0];
  if (remoteName === undefined) {
    return undefined;
  }

  const url = (await runOptionalGit(command, ["remote", "get-url", remoteName]))?.stdout.trim();
  if (url === undefined || url.length === 0) {
    return undefined;
  }

  const remote = parseRepositoryRemote(url);
  if (remote === undefined || !isGithubHost(remote.host)) {
    return undefined;
  }

  const clock = input.clock ?? systemClock;
  return {
    worktreeId: input.worktree.id,
    projectId: input.worktree.projectId,
    path: normalize(input.worktree.path),
    branch: input.worktree.branch,
    headSha,
    remoteName,
    remote,
    checkedAt: toIsoTimestamp(clock.now()),
  };
}

export function parseRepositoryRemote(url: string): RepositoryRemote | undefined {
  const trimmed = url.trim();
  const sshScp = trimmed.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshScp !== null) {
    const host = sshScp[1];
    const owner = sshScp[2];
    const repo = sshScp[3];
    if (host !== undefined && owner !== undefined && repo !== undefined) {
      return {
        host: normalizeHost(host),
        owner,
        repo: stripGitSuffix(repo),
        url: trimmed,
      };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:" && parsed.protocol !== "git:") {
    return undefined;
  }

  const segments = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const owner = segments[0];
  const repo = segments[1];
  if (owner === undefined || repo === undefined) {
    return undefined;
  }
  return {
    host: normalizeHost(parsed.hostname),
    owner,
    repo: stripGitSuffix(repo),
    url: trimmed,
  };
}

export function repositoryMetadataCacheKey(input: {
  kind: "pull_request" | "checks";
  worktreeId: string;
  path: string;
  host: string;
  owner: string;
  repo: string;
  branch: string;
  headSha: string;
  pullRequestNumber?: number;
}): string {
  const key: {
    kind: "pull_request" | "checks";
    worktreeId: string;
    path: string;
    host: string;
    owner: string;
    repo: string;
    branch: string;
    headSha: string;
    pullRequestNumber?: number;
  } = {
    kind: input.kind,
    worktreeId: input.worktreeId,
    path: normalize(input.path),
    host: input.host.toLowerCase(),
    owner: input.owner.toLowerCase(),
    repo: input.repo.toLowerCase(),
    branch: input.branch,
    headSha: input.headSha.toLowerCase(),
  };
  if (input.pullRequestNumber !== undefined) {
    key.pullRequestNumber = input.pullRequestNumber;
  }
  return JSON.stringify(key);
}

async function runGit(command: GitCommandContext, args: string[]) {
  const input: Parameters<typeof runExternalCommand>[0] = {
    command: "git",
    args,
    cwd: command.cwd,
    timeoutMs: command.timeoutMs,
    maxOutputChars: 4096,
  };
  if (command.signal !== undefined) input.signal = command.signal;
  return runExternalCommand(input, command.runner);
}

async function runOptionalGit(command: GitCommandContext, args: string[]) {
  try {
    return await runGit(command, args);
  } catch {
    return undefined;
  }
}

function isGithubHost(host: string): boolean {
  return host === "github.com" || host.endsWith(".github.com") || host.includes("github.");
}

function normalizeHost(value: string): string {
  return value.toLowerCase();
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}
