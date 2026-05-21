import type { ProviderId, ProviderProjectConfig, WorktreeObservation } from "@wosm/contracts";
import { WorktreeObservationSchema } from "@wosm/contracts";
import { WorktrunkProviderError } from "./errors.js";
import {
  applyMetadataToObservation,
  providerNativeMetadataFromWorktrunkItem,
  type WorktrunkMetadata,
} from "./metadata.js";

export type ParseWorktrunkListOptions = {
  project: ProviderProjectConfig;
  providerId?: ProviderId;
  observedAt: string;
};

export type WorktrunkListItem = Record<string, unknown>;

export function parseWorktrunkListJson(
  stdout: string,
  options: ParseWorktrunkListOptions,
): WorktreeObservation[] {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch (cause) {
    throw new WorktrunkProviderError(
      "WORKTRUNK_INVALID_OUTPUT",
      "Worktrunk list output is not valid JSON.",
      { cause },
    );
  }

  return parseWorktrunkListPayload(payload, options);
}

export function parseWorktrunkListPayload(
  payload: unknown,
  options: ParseWorktrunkListOptions,
): WorktreeObservation[] {
  const items = normalizePayload(payload);
  return items
    .filter((item) => hasWorktreePath(item))
    .map((item) => parseWorktrunkListItem(item, options));
}

export function parseWorktrunkListItem(
  item: WorktrunkListItem,
  options: ParseWorktrunkListOptions,
): WorktreeObservation {
  const path = stringField(item, "path") ?? stringField(item, "worktree_path");
  if (path === undefined) {
    throw new WorktrunkProviderError(
      "WORKTRUNK_INVALID_OUTPUT",
      "Worktrunk list output did not include a worktree path.",
    );
  }

  const metadata = providerNativeMetadataFromWorktrunkItem(item);
  const branch = branchFromItem(item);
  const main = recordField(item, "main");
  const observation = WorktreeObservationSchema.parse({
    id: metadata?.worktreeId ?? worktreeId(options.project.id, branch, path),
    provider: options.providerId ?? "worktrunk",
    projectId: options.project.id,
    branch,
    path,
    state: stateFromItem(item),
    source: "worktrunk",
    dirty: dirtyFromItem(item),
    ...(numberField(main, "ahead") === undefined ? {} : { ahead: numberField(main, "ahead") }),
    ...(numberField(main, "behind") === undefined ? {} : { behind: numberField(main, "behind") }),
    confidence: "high",
    reason: "Worktrunk listed this worktree.",
    observedAt: options.observedAt,
    providerData: {
      worktrunk: safeProviderData(item),
      ...(metadata === undefined ? {} : { metadata }),
    },
  });

  return applyMetadataToObservation(observation, metadata);
}

function normalizePayload(payload: unknown): WorktrunkListItem[] {
  if (Array.isArray(payload)) {
    return payload.map(assertItem);
  }

  const record = asRecord(payload);
  if (record !== undefined) {
    const nested = record.worktrees ?? record.items ?? record.results;
    if (Array.isArray(nested)) {
      return nested.map(assertItem);
    }
    if (hasWorktreePath(record)) {
      return [record];
    }
  }

  throw new WorktrunkProviderError(
    "WORKTRUNK_INVALID_OUTPUT",
    "Worktrunk list output must be an array or object containing worktrees.",
  );
}

function assertItem(value: unknown): WorktrunkListItem {
  const record = asRecord(value);
  if (record === undefined) {
    throw new WorktrunkProviderError(
      "WORKTRUNK_INVALID_OUTPUT",
      "Worktrunk list entries must be JSON objects.",
    );
  }
  return record;
}

function branchFromItem(item: WorktrunkListItem): string {
  const explicit = stringField(item, "branch") ?? stringField(item, "name");
  if (explicit !== undefined) {
    return explicit;
  }

  const git = recordField(item, "git");
  const detached =
    stringField(git, "short_sha") ??
    stringField(git, "shortSha") ??
    stringField(item, "short_sha") ??
    stringField(item, "shortSha") ??
    stringField(git, "sha")?.slice(0, 12) ??
    stringField(item, "sha")?.slice(0, 12);

  if (detached !== undefined) {
    return `detached:${detached}`;
  }

  const path = stringField(item, "path") ?? "unknown";
  return `detached:${basename(path)}`;
}

function stateFromItem(item: WorktrunkListItem): WorktreeObservation["state"] {
  const worktree = recordField(item, "worktree");
  const state = (stringField(worktree, "state") ?? stringField(item, "state") ?? "").toLowerCase();
  if (state === "prunable" || state === "missing" || state === "no_worktree") {
    return "missing";
  }
  if (state === "orphaned" || state === "orphan") {
    return "orphaned";
  }
  return "exists";
}

function dirtyFromItem(item: WorktrunkListItem): boolean | undefined {
  const dirty = booleanField(item, "dirty") ?? booleanField(recordField(item, "git"), "dirty");
  if (dirty !== undefined) {
    return dirty;
  }

  const worktree = recordField(item, "worktree");
  const changes = [
    numberField(worktree, "staged"),
    numberField(worktree, "modified"),
    numberField(worktree, "untracked"),
    numberField(worktree, "renamed"),
    numberField(worktree, "deleted"),
    numberField(recordField(worktree, "diff"), "added"),
    numberField(recordField(worktree, "diff"), "deleted"),
  ].filter((value): value is number => value !== undefined);

  return changes.length === 0 ? undefined : changes.some((value) => value > 0);
}

function safeProviderData(item: WorktrunkListItem): Record<string, unknown> {
  const metadata = providerNativeMetadataFromWorktrunkItem(item);
  return {
    ...(stringField(item, "kind") === undefined ? {} : { kind: stringField(item, "kind") }),
    ...(stringField(item, "state") === undefined ? {} : { state: stringField(item, "state") }),
    ...(booleanField(item, "is_current") === undefined
      ? {}
      : { isCurrent: booleanField(item, "is_current") }),
    ...(booleanField(item, "isCurrent") === undefined
      ? {}
      : { isCurrent: booleanField(item, "isCurrent") }),
    ...(booleanField(item, "is_main") === undefined
      ? {}
      : { isMain: booleanField(item, "is_main") }),
    ...(booleanField(item, "is_previous") === undefined
      ? {}
      : { isPrevious: booleanField(item, "is_previous") }),
    ...(stringField(item, "symbols") === undefined
      ? {}
      : { symbols: stringField(item, "symbols") }),
    ...(metadata === undefined ? {} : { metadata: safeMetadata(metadata) }),
  };
}

function safeMetadata(metadata: WorktrunkMetadata): WorktrunkMetadata {
  return metadata;
}

function hasWorktreePath(item: unknown): item is WorktrunkListItem {
  const record = asRecord(item);
  return (
    record !== undefined &&
    (typeof record.path === "string" || typeof record.worktree_path === "string")
  );
}

function worktreeId(projectId: string, branch: string, path: string): string {
  return `wt_${sanitizeId(projectId)}_${sanitizeId(branch || path)}`;
}

function sanitizeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._:-]+/g, "_").replace(/^_+|_+$/g, "") || "worktree";
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function recordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  return asRecord(record?.[key]);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function booleanField(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}
