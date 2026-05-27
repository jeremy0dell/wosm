import { existsSync, type FSWatcher, lstatSync, readFileSync, watch } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { WorktreeRow, WosmSnapshot } from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";

export type WorktreeGitWatchService = {
  update(snapshot: WosmSnapshot): void;
  shutdown(): void;
};

export type CreateWorktreeGitWatchServiceOptions = {
  requestReconcile(reason: string): void;
  debounceMs?: number;
  logger?: JsonlLogger;
  watchDirectory?: WatchDirectory;
};

export type GitWatchTarget = {
  path: string;
};

type DirectoryWatcher = Pick<FSWatcher, "close"> & {
  on?(event: "error", listener: (error: Error) => void): unknown;
};

type WatchDirectory = (
  directory: string,
  listener: (changedFile: string | undefined) => void,
) => DirectoryWatcher;

const defaultDebounceMs = 100;

export function createWorktreeGitWatchService(
  options: CreateWorktreeGitWatchServiceOptions,
): WorktreeGitWatchService {
  const debounceMs = options.debounceMs ?? defaultDebounceMs;
  const watchers = new Map<string, DirectoryWatcher>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const watchDirectory = options.watchDirectory ?? defaultWatchDirectory;

  return {
    update: (snapshot) => {
      const nextKeys = new Set<string>();
      for (const row of snapshot.rows) {
        if (row.worktree.state !== "exists") {
          continue;
        }
        for (const target of gitWatchTargetsForRow(row)) {
          const key = watcherKey(row.id, target.path);
          nextKeys.add(key);
          if (watchers.has(key)) {
            continue;
          }
          const watcher = watchTarget(row.id, target);
          if (watcher !== undefined) {
            watchers.set(key, watcher);
          }
        }
      }

      for (const [key, watcher] of watchers) {
        if (nextKeys.has(key)) {
          continue;
        }
        watcher.close();
        watchers.delete(key);
      }
    },
    shutdown: () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
    },
  };

  function watchTarget(worktreeId: string, target: GitWatchTarget): DirectoryWatcher | undefined {
    const directory = dirname(target.path);
    if (!existsSync(directory)) {
      return undefined;
    }

    try {
      const fileName = basename(target.path);
      const watcher = watchDirectory(directory, (changedFile) => {
        if (changedFile !== undefined && changedFile !== fileName) {
          return;
        }
        scheduleReconcile(worktreeId);
      });
      watcher.on?.("error", (error) => {
        void options.logger?.warn("Git metadata watcher failed.", {
          error,
          path: target.path,
          worktreeId,
        });
      });
      return watcher;
    } catch (error) {
      void options.logger?.warn("Git metadata watcher could not start.", {
        error,
        path: target.path,
        worktreeId,
      });
      return undefined;
    }
  }

  function scheduleReconcile(worktreeId: string): void {
    const existing = timers.get(worktreeId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      timers.delete(worktreeId);
      options.requestReconcile(`metadata:git:${worktreeId}`);
    }, debounceMs);
    timers.set(worktreeId, timer);
  }
}

export function gitWatchTargetsForRow(row: WorktreeRow): GitWatchTarget[] {
  return gitWatchTargetsForWorktree(row.path, row.branch);
}

export function gitWatchTargetsForWorktree(worktreePath: string, branch: string): GitWatchTarget[] {
  const dotGit = join(worktreePath, ".git");
  const gitDir = resolveGitDir(dotGit);
  if (gitDir === undefined) {
    return [];
  }

  const targets: GitWatchTarget[] = [{ path: dotGit }, { path: join(gitDir, "HEAD") }];
  const headRef = readHeadRef(join(gitDir, "HEAD"));
  const commonDir = resolveCommonDir(gitDir);
  const refName = headRef ?? `refs/heads/${branch}`;
  targets.push({ path: join(commonDir, refName) });
  targets.push({ path: join(commonDir, "packed-refs") });
  return uniqueTargets(targets);
}

function resolveGitDir(dotGit: string): string | undefined {
  if (!existsSync(dotGit)) {
    return undefined;
  }

  try {
    if (lstatSync(dotGit).isDirectory()) {
      return dotGit;
    }
    const content = readFileSync(dotGit, "utf8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/i);
    const value = match?.[1]?.trim();
    if (value === undefined || value.length === 0) {
      return undefined;
    }
    return isAbsolute(value) ? value : resolve(dirname(dotGit), value);
  } catch {
    return undefined;
  }
}

function readHeadRef(headPath: string): string | undefined {
  try {
    const content = readFileSync(headPath, "utf8").trim();
    const match = content.match(/^ref:\s*(.+)$/);
    const ref = match?.[1]?.trim();
    return ref === undefined || ref.length === 0 ? undefined : ref;
  } catch {
    return undefined;
  }
}

function resolveCommonDir(gitDir: string): string {
  const commonDirPath = join(gitDir, "commondir");
  try {
    const content = readFileSync(commonDirPath, "utf8").trim();
    if (content.length === 0) {
      return gitDir;
    }
    return isAbsolute(content) ? content : resolve(gitDir, content);
  } catch {
    return gitDir;
  }
}

function uniqueTargets(targets: GitWatchTarget[]): GitWatchTarget[] {
  const seen = new Set<string>();
  const unique: GitWatchTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.path)) {
      continue;
    }
    seen.add(target.path);
    unique.push(target);
  }
  return unique;
}

function watcherKey(worktreeId: string, path: string): string {
  return `${worktreeId}:${path}`;
}

function defaultWatchDirectory(
  directory: string,
  listener: (changedFile: string | undefined) => void,
): DirectoryWatcher {
  return watch(directory, (_event, changedFile) => {
    listener(changedFile === null ? undefined : changedFile.toString());
  });
}
