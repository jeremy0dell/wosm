import type { ProviderProjectConfig, WosmSnapshot } from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import {
  type ExternalCommandRunner,
  type RuntimeClock,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import { toSafeError } from "../diagnostics/errors.js";
import type {
  ObserverPersistence,
  PersistedWorktreeMetadataCurrent,
} from "../persistence/index.js";
import { type LocalGitWorktree, readLocalGitChangeSummary } from "./localGitChangeSummary.js";

export type WorktreeMetadataRefreshService = {
  refresh(snapshot: WosmSnapshot): Promise<void>;
};

export type CreateWorktreeMetadataRefreshServiceOptions = {
  projects: ProviderProjectConfig[];
  persistence: ObserverPersistence;
  requestReconcile(reason: string): void;
  clock?: RuntimeClock;
  logger?: JsonlLogger;
  runner?: ExternalCommandRunner;
  gitTimeoutMs?: number;
  ttlMs?: number;
  concurrency?: number;
};

const defaultGitTimeoutMs = 200;
const defaultTtlMs = 5 * 60 * 1000;
const defaultConcurrency = 2;

export function createWorktreeMetadataRefreshService(
  options: CreateWorktreeMetadataRefreshServiceOptions,
): WorktreeMetadataRefreshService {
  const clock = options.clock ?? systemClock;
  const projectsById = new Map(options.projects.map((project) => [project.id, project]));
  const concurrency = options.concurrency ?? defaultConcurrency;
  let pendingSnapshot: WosmSnapshot | undefined;
  let running: Promise<void> | undefined;

  return {
    refresh: async (snapshot) => {
      pendingSnapshot = snapshot;
      if (running !== undefined) {
        await running;
        return;
      }

      running = runPendingRefreshes().finally(() => {
        running = undefined;
      });
      await running;
    },
  };

  async function runPendingRefreshes(): Promise<void> {
    while (pendingSnapshot !== undefined) {
      const snapshot = pendingSnapshot;
      pendingSnapshot = undefined;
      await refreshSnapshot(snapshot);
    }
  }

  async function refreshSnapshot(snapshot: WosmSnapshot): Promise<void> {
    const referenceTime = toIsoTimestamp(clock.now());
    const [changeRows, pullRequestRows] = await Promise.all([
      options.persistence.listWorktreeMetadataCurrent({
        kind: "change_summary",
        includeExpired: true,
        now: referenceTime,
      }),
      options.persistence.listWorktreeMetadataCurrent({
        kind: "pull_request",
        now: referenceTime,
      }),
    ]);
    const changeByWorktree = new Map(changeRows.map((row) => [row.worktreeId, row]));
    const pullRequestByWorktree = new Map(
      pullRequestRows.map((row) => [row.worktreeId, row.payload]),
    );

    await runWithConcurrency(snapshot.rows, concurrency, async (row) => {
      const project = projectsById.get(row.projectId);
      if (project === undefined) {
        return;
      }

      const refreshInput: {
        project: ProviderProjectConfig;
        row: WosmSnapshot["rows"][number];
        existing?: PersistedWorktreeMetadataCurrent<"change_summary">;
        cachedPullRequest?: WosmSnapshot["rows"][number]["worktree"]["pr"];
      } = {
        project,
        row,
      };
      const existing = changeByWorktree.get(row.id);
      const cachedPullRequest = pullRequestByWorktree.get(row.id);
      if (existing !== undefined) refreshInput.existing = existing;
      if (cachedPullRequest !== undefined) refreshInput.cachedPullRequest = cachedPullRequest;
      await refreshRow(refreshInput);
    });
  }

  async function refreshRow(input: {
    project: ProviderProjectConfig;
    row: WosmSnapshot["rows"][number];
    existing?: PersistedWorktreeMetadataCurrent<"change_summary">;
    cachedPullRequest?: WosmSnapshot["rows"][number]["worktree"]["pr"];
  }): Promise<void> {
    if (shouldBackOffFailedRefresh(input.existing)) {
      return;
    }

    try {
      const worktree: LocalGitWorktree = {
        id: input.row.id,
        projectId: input.row.projectId,
        path: input.row.path,
        branch: input.row.branch,
        state: input.row.worktree.state,
      };
      if (input.row.worktree.pr !== undefined) {
        worktree.pr = input.row.worktree.pr;
      }

      const result = await readLocalGitChangeSummary({
        project: input.project,
        worktree,
        ...(input.cachedPullRequest === undefined
          ? {}
          : { cachedPullRequest: input.cachedPullRequest }),
        timeoutMs: options.gitTimeoutMs ?? defaultGitTimeoutMs,
        clock,
        ...(options.runner === undefined ? {} : { runner: options.runner }),
      });

      if (result === undefined) {
        if (input.existing !== undefined) {
          const deleted = await options.persistence.deleteWorktreeMetadataCurrent({
            worktreeId: input.row.id,
            kind: "change_summary",
          });
          if (deleted > 0) {
            options.requestReconcile("metadata:change_summary");
          }
        }
        return;
      }

      if (
        input.existing !== undefined &&
        !input.existing.expired &&
        input.existing.cacheKey === result.cacheKey
      ) {
        return;
      }

      await options.persistence.upsertWorktreeMetadataCurrent({
        worktreeId: input.row.id,
        kind: "change_summary",
        payload: result.summary,
        cacheKey: result.cacheKey,
        updatedAt: result.summary.checkedAt,
        expiresAt: addMs(result.summary.checkedAt, options.ttlMs ?? defaultTtlMs),
      });
      options.requestReconcile("metadata:change_summary");
    } catch (error) {
      await handleRefreshFailure(input, error);
    }
  }

  async function handleRefreshFailure(
    input: {
      row: WosmSnapshot["rows"][number];
      existing?: PersistedWorktreeMetadataCurrent<"change_summary">;
    },
    error: unknown,
  ): Promise<void> {
    const safeError = toSafeError(
      error,
      {
        tag: "LocalGitMetadataError",
        code: "LOCAL_GIT_CHANGE_SUMMARY_FAILED",
        message: "Local git change summary refresh failed.",
      },
      {
        projectId: input.row.projectId,
        worktreeId: input.row.id,
      },
    );

    if (input.existing !== undefined) {
      const failedAt = toIsoTimestamp(clock.now());
      await options.persistence.upsertWorktreeMetadataCurrent({
        worktreeId: input.row.id,
        kind: "change_summary",
        payload: {
          ...input.existing.payload,
          stale: true,
        },
        ...(input.existing.cacheKey === undefined ? {} : { cacheKey: input.existing.cacheKey }),
        expiresAt: addMs(failedAt, options.ttlMs ?? defaultTtlMs),
        updatedAt: failedAt,
        stale: true,
        lastError: safeError,
      });
      options.requestReconcile("metadata:change_summary");
      return;
    }

    await options.logger?.warn("Local git metadata refresh failed.", {
      projectId: input.row.projectId,
      worktreeId: input.row.id,
      error: safeError,
    });
  }
}

function shouldBackOffFailedRefresh(
  existing: PersistedWorktreeMetadataCurrent<"change_summary"> | undefined,
): boolean {
  return existing?.stale === true && existing.lastError !== undefined && !existing.expired;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item === undefined) {
        return;
      }
      await task(item);
    }
  });
  await Promise.all(workers);
}

function addMs(timestamp: string, ms: number): string {
  return new Date(Date.parse(timestamp) + ms).toISOString();
}
