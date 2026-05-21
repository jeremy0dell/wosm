import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HookReceipt, HookSpoolRecord, ProviderHookEvent, SafeError } from "@wosm/contracts";
import { HookReceiptSchema, HookSpoolRecordSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { type RuntimeClock, systemClock, toIsoTimestamp } from "@wosm/runtime";

export type WriteHookSpoolRecordOptions = {
  spoolDir: string;
  event: ProviderHookEvent;
  error?: SafeError;
  clock?: RuntimeClock;
  spoolId?: () => string;
};

const defaultSpoolId = () => `spool_${Date.now()}_${randomUUID()}`;

export async function writeHookSpoolRecord(
  options: WriteHookSpoolRecordOptions,
): Promise<HookReceipt> {
  const clock = options.clock ?? systemClock;
  const spoolId = (options.spoolId ?? defaultSpoolId)();
  await mkdir(options.spoolDir, { recursive: true, mode: 0o700 });
  await chmod(options.spoolDir, 0o700);

  const record: HookSpoolRecord = HookSpoolRecordSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    spoolId,
    createdAt: toIsoTimestamp(clock.now()),
    event: options.event,
    attempts: 0,
    ...(options.error === undefined ? {} : { lastError: options.error }),
  });
  await writeFile(join(options.spoolDir, `${spoolId}.json`), JSON.stringify(record, null, 2), {
    mode: 0o600,
    flag: "wx",
  });

  return HookReceiptSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: spoolId,
    provider: options.event.provider,
    event: options.event.event,
    accepted: true,
    status: "spooled",
    receivedAt: options.event.receivedAt,
    spooled: true,
    ...(options.error === undefined ? {} : { error: options.error }),
  });
}
