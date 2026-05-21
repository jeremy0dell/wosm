import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HookSpoolRecord, ProviderHookEvent, SafeError } from "@wosm/contracts";
import { HookSpoolRecordSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";

export async function listHookSpoolFiles(spoolDir: string): Promise<string[]> {
  try {
    return (await readdir(spoolDir)).filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

export async function readHookSpoolRecord(
  spoolDir: string,
  fileName: string,
): Promise<HookSpoolRecord> {
  return HookSpoolRecordSchema.parse(JSON.parse(await readFile(join(spoolDir, fileName), "utf8")));
}

export async function fileMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeHookSpoolRecordFixture(input: {
  spoolDir: string;
  spoolId: string;
  event?: Partial<ProviderHookEvent>;
  lastError?: SafeError;
  createdAt?: string;
}): Promise<string> {
  await mkdir(input.spoolDir, { recursive: true });
  const createdAt = input.createdAt ?? "2026-05-20T12:00:00.000Z";
  const record: HookSpoolRecord = HookSpoolRecordSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    spoolId: input.spoolId,
    createdAt,
    attempts: 0,
    event: {
      schemaVersion: WOSM_SCHEMA_VERSION,
      provider: "worktrunk",
      kind: "worktree",
      event: "worktree.created",
      receivedAt: createdAt,
      ...input.event,
    },
    ...(input.lastError === undefined ? {} : { lastError: input.lastError }),
  });
  const path = join(input.spoolDir, `${input.spoolId}.json`);
  await writeFile(path, JSON.stringify(record, null, 2), { mode: 0o600 });
  return path;
}

export async function writeInvalidHookSpoolFile(input: {
  spoolDir: string;
  fileName?: string;
  content?: string;
}): Promise<string> {
  await mkdir(input.spoolDir, { recursive: true });
  const path = join(input.spoolDir, input.fileName ?? "invalid.json");
  await writeFile(path, input.content ?? "{ invalid json", { mode: 0o600 });
  return path;
}
