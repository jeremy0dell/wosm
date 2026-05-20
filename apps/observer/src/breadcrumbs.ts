import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ProjectConfig } from "@wosm/config";

export type RecoveryBreadcrumb = {
  schemaVersion: 1;
  projectId: string;
  worktreeId?: string;
  sessionId?: string;
  createdBy: "wosm";
  createdAt: string;
  provider?: string;
  note?: string;
};

export type ParsedRecoveryBreadcrumb = {
  breadcrumb: RecoveryBreadcrumb;
  authoritative: false;
};

export type RecoveryBreadcrumbLocation = "external" | "worktree";

export type WriteRecoveryBreadcrumbInput = {
  breadcrumb: RecoveryBreadcrumb;
  location?: RecoveryBreadcrumbLocation;
  stateDir: string;
  project?: Pick<ProjectConfig, "id" | "root" | "recoveryBreadcrumbs">;
  worktreePath?: string;
};

export type RecoveryBreadcrumbWriteResult = ParsedRecoveryBreadcrumb & {
  path: string;
  location: RecoveryBreadcrumbLocation;
};

export class RecoveryBreadcrumbError extends Error {
  readonly tag = "RecoveryBreadcrumbError" as const;
  readonly code:
    | "RECOVERY_BREADCRUMB_INVALID"
    | "RECOVERY_BREADCRUMB_UNSAFE"
    | "RECOVERY_BREADCRUMB_WORKTREE_NOT_OPTED_IN";

  constructor(
    code: RecoveryBreadcrumbError["code"],
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = this.tag;
    this.code = code;
  }
}

export function externalRecoveryBreadcrumbPath(input: {
  stateDir: string;
  projectId: string;
  worktreeId?: string;
  sessionId?: string;
}): string {
  const parsedProjectId = parseSafeId(input.projectId);
  const suffix = input.worktreeId ?? input.sessionId ?? "project";
  const parsedSuffix = parseSafeId(suffix);
  return join(input.stateDir, "markers", `${parsedProjectId}__${parsedSuffix}.json`);
}

export function inWorktreeRecoveryBreadcrumbPath(input: {
  project: Pick<ProjectConfig, "recoveryBreadcrumbs"> | undefined;
  worktreePath: string;
}): string {
  assertInWorktreeBreadcrumbOptIn(input.project);
  const configuredPath =
    input.project?.recoveryBreadcrumbs?.path ?? ".wosm/recovery-breadcrumb.json";
  return resolve(input.worktreePath, configuredPath);
}

export function assertInWorktreeBreadcrumbOptIn(
  project: Pick<ProjectConfig, "recoveryBreadcrumbs"> | undefined,
): void {
  if (project?.recoveryBreadcrumbs?.location !== "worktree") {
    throw new RecoveryBreadcrumbError(
      "RECOVERY_BREADCRUMB_WORKTREE_NOT_OPTED_IN",
      "In-worktree recovery breadcrumbs require explicit project opt-in.",
    );
  }
}

export function parseRecoveryBreadcrumbJson(source: string): ParsedRecoveryBreadcrumb {
  if (looksLikeShellState(source)) {
    throw new RecoveryBreadcrumbError(
      "RECOVERY_BREADCRUMB_UNSAFE",
      "Recovery breadcrumbs must be parse-only JSON, not shell state.",
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(source);
  } catch (cause) {
    throw new RecoveryBreadcrumbError(
      "RECOVERY_BREADCRUMB_INVALID",
      "Recovery breadcrumb is not valid JSON.",
      { cause },
    );
  }

  if (containsUnsafeRecoveryData(payload)) {
    throw new RecoveryBreadcrumbError(
      "RECOVERY_BREADCRUMB_UNSAFE",
      "Recovery breadcrumb contains unsafe recovery data.",
    );
  }

  return {
    breadcrumb: validateRecoveryBreadcrumb(payload),
    authoritative: false,
  };
}

export async function readRecoveryBreadcrumbFile(path: string): Promise<ParsedRecoveryBreadcrumb> {
  return parseRecoveryBreadcrumbJson(await readFile(path, "utf8"));
}

export async function writeRecoveryBreadcrumb(
  input: WriteRecoveryBreadcrumbInput,
): Promise<RecoveryBreadcrumbWriteResult> {
  const breadcrumb = validateRecoveryBreadcrumb(input.breadcrumb);
  const configuredLocation = input.project?.recoveryBreadcrumbs?.location;
  const location = input.location ?? (configuredLocation === "worktree" ? "worktree" : "external");
  const path =
    location === "worktree"
      ? inWorktreeRecoveryBreadcrumbPath({
          project: input.project,
          worktreePath: input.worktreePath ?? input.project?.root ?? "",
        })
      : externalRecoveryBreadcrumbPath({
          stateDir: input.stateDir,
          projectId: breadcrumb.projectId,
          ...(breadcrumb.worktreeId === undefined ? {} : { worktreeId: breadcrumb.worktreeId }),
          ...(breadcrumb.sessionId === undefined ? {} : { sessionId: breadcrumb.sessionId }),
        });

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(breadcrumb, null, 2)}\n`, { mode: 0o600 });

  return {
    path,
    location,
    breadcrumb,
    authoritative: false,
  };
}

function parseSafeId(value: string): string {
  if (!/^[a-zA-Z0-9._:-]+$/.test(value)) {
    throw new RecoveryBreadcrumbError(
      "RECOVERY_BREADCRUMB_INVALID",
      "Recovery breadcrumb IDs may only contain safe filename characters.",
    );
  }
  return value;
}

function validateRecoveryBreadcrumb(value: unknown): RecoveryBreadcrumb {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RecoveryBreadcrumbError(
      "RECOVERY_BREADCRUMB_INVALID",
      "Recovery breadcrumb must be a JSON object.",
    );
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "schemaVersion",
    "projectId",
    "worktreeId",
    "sessionId",
    "createdBy",
    "createdAt",
    "provider",
    "note",
  ]);

  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new RecoveryBreadcrumbError(
      "RECOVERY_BREADCRUMB_INVALID",
      "Recovery breadcrumb contains unsupported fields.",
    );
  }

  if (
    record.schemaVersion !== 1 ||
    record.createdBy !== "wosm" ||
    typeof record.projectId !== "string" ||
    record.projectId.length === 0 ||
    typeof record.createdAt !== "string" ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    (record.worktreeId !== undefined &&
      (typeof record.worktreeId !== "string" || record.worktreeId.length === 0)) ||
    (record.sessionId !== undefined &&
      (typeof record.sessionId !== "string" || record.sessionId.length === 0)) ||
    (record.provider !== undefined &&
      (typeof record.provider !== "string" || record.provider.length === 0)) ||
    (record.note !== undefined &&
      (typeof record.note !== "string" || record.note.length === 0 || record.note.length > 240))
  ) {
    throw new RecoveryBreadcrumbError(
      "RECOVERY_BREADCRUMB_INVALID",
      "Recovery breadcrumb has invalid fields.",
    );
  }

  return {
    schemaVersion: 1,
    projectId: record.projectId,
    ...(record.worktreeId === undefined ? {} : { worktreeId: record.worktreeId }),
    ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
    createdBy: "wosm",
    createdAt: record.createdAt,
    ...(record.provider === undefined ? {} : { provider: record.provider }),
    ...(record.note === undefined ? {} : { note: record.note }),
  };
}

function looksLikeShellState(source: string): boolean {
  const trimmed = source.trimStart();
  return (
    trimmed.startsWith("#!") || trimmed.startsWith("export ") || /^[A-Z_][A-Z0-9_]*=/.test(trimmed)
  );
}

function containsUnsafeRecoveryData(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsUnsafeRecoveryData);
  }
  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("secret") ||
      normalizedKey.includes("token") ||
      normalizedKey.includes("prompt") ||
      normalizedKey.includes("transcript")
    ) {
      return true;
    }
    if (containsUnsafeRecoveryData(child)) {
      return true;
    }
  }

  return false;
}
