import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ProviderProjectConfig,
  RecoveryBreadcrumbSchema,
  type WorktreeObservation,
} from "@wosm/contracts";

export type WorktrunkMetadata = {
  source: "provider-native" | "worktree-breadcrumb";
  projectId?: string;
  worktreeId?: string;
  sessionId?: string;
};

type ReadTextFile = (path: string) => Promise<string>;

export function providerNativeMetadataFromWorktrunkItem(
  item: unknown,
): WorktrunkMetadata | undefined {
  const record = asRecord(item);
  if (record === undefined) {
    return undefined;
  }

  const vars = asRecord(record.vars);
  const wosm = asRecord(vars?.wosm);
  const candidates = [
    {
      projectId: stringValue(wosm?.project_id ?? wosm?.projectId),
      worktreeId: stringValue(wosm?.worktree_id ?? wosm?.worktreeId),
      sessionId: stringValue(wosm?.session_id ?? wosm?.sessionId),
    },
    {
      projectId: stringValue(vars?.wosm_project_id ?? vars?.WOSM_PROJECT_ID),
      worktreeId: stringValue(vars?.wosm_worktree_id ?? vars?.WOSM_WORKTREE_ID),
      sessionId: stringValue(vars?.wosm_session_id ?? vars?.WOSM_SESSION_ID),
    },
  ];

  const candidate = candidates.find((value) =>
    [value.projectId, value.worktreeId, value.sessionId].some((field) => field !== undefined),
  );
  if (candidate === undefined) {
    return undefined;
  }

  return {
    source: "provider-native",
    ...(candidate.projectId === undefined ? {} : { projectId: candidate.projectId }),
    ...(candidate.worktreeId === undefined ? {} : { worktreeId: candidate.worktreeId }),
    ...(candidate.sessionId === undefined ? {} : { sessionId: candidate.sessionId }),
  };
}

export async function applyRecoveryBreadcrumbMetadata(
  observation: WorktreeObservation,
  project: ProviderProjectConfig,
  options: { readTextFile?: ReadTextFile } = {},
): Promise<WorktreeObservation> {
  if (metadataFromObservation(observation)?.source === "provider-native") {
    return observation;
  }
  if (project.recoveryBreadcrumbs?.location !== "worktree") {
    return observation;
  }

  const configuredPath = project.recoveryBreadcrumbs.path ?? ".wosm/recovery-breadcrumb.json";
  const path = resolve(observation.path, configuredPath);
  const source = await readOptionalText(path, options.readTextFile ?? readFileUtf8);
  if (source === undefined) {
    return observation;
  }

  const metadata = parseBreadcrumbMetadata(source);
  if (metadata === undefined || metadata.projectId !== project.id) {
    return observation;
  }

  return applyMetadataToObservation(observation, metadata);
}

export function applyMetadataToObservation(
  observation: WorktreeObservation,
  metadata: WorktrunkMetadata | undefined,
): WorktreeObservation {
  if (metadata === undefined) {
    return observation;
  }

  const providerData = asRecord(observation.providerData) ?? {};
  return {
    ...observation,
    id: metadata.worktreeId ?? observation.id,
    providerData: {
      ...providerData,
      metadata,
    },
  };
}

export function metadataFromObservation(
  observation: WorktreeObservation,
): WorktrunkMetadata | undefined {
  return asRecord(observation.providerData)?.metadata as WorktrunkMetadata | undefined;
}

function parseBreadcrumbMetadata(source: string): WorktrunkMetadata | undefined {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return undefined;
  }

  const parsed = RecoveryBreadcrumbSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }

  const breadcrumb = parsed.data;

  return {
    source: "worktree-breadcrumb",
    projectId: breadcrumb.projectId,
    ...(breadcrumb.worktreeId === undefined ? {} : { worktreeId: breadcrumb.worktreeId }),
    ...(breadcrumb.sessionId === undefined ? {} : { sessionId: breadcrumb.sessionId }),
  };
}

async function readOptionalText(
  path: string,
  readTextFile: ReadTextFile,
): Promise<string | undefined> {
  try {
    return await readTextFile(path);
  } catch {
    return undefined;
  }
}

async function readFileUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
