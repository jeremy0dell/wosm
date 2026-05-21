import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { HookReceipt, HookSpoolRecord, ProviderHookEvent, WosmEvent } from "@wosm/contracts";
import { HookSpoolRecordSchema } from "@wosm/contracts";
import { type RuntimeClock, systemClock, toIsoTimestamp } from "@wosm/runtime";
import type { ObserverPersistence } from "../persistence/index.js";
import type { ObserverEventBus } from "../runtime/eventBus.js";

export type HookSpoolDrainResult = {
  scanned: number;
  drained: number;
  failed: number;
};

export type DrainHookSpoolOptions = {
  spoolDir: string;
  ingest(event: ProviderHookEvent): Promise<HookReceipt>;
  persistence?: ObserverPersistence;
  eventBus?: ObserverEventBus;
  clock?: RuntimeClock;
};

export function hookSpoolDir(stateDir: string): string {
  return join(stateDir, "spool", "hooks");
}

export async function listHookSpoolRecords(spoolDir: string): Promise<
  Array<{
    path: string;
    record: HookSpoolRecord;
  }>
> {
  let entries: string[];
  try {
    entries = await readdir(spoolDir);
  } catch {
    return [];
  }

  const records: Array<{ path: string; record: HookSpoolRecord }> = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const path = join(spoolDir, entry);
    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      records.push({
        path,
        record: HookSpoolRecordSchema.parse(raw),
      });
    } catch {
      // Invalid spool files are left in place for later diagnostics.
    }
  }
  return records;
}

export async function hookSpoolDepth(spoolDir: string): Promise<number> {
  try {
    return (await readdir(spoolDir)).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export async function drainHookSpool(
  options: DrainHookSpoolOptions,
): Promise<HookSpoolDrainResult> {
  const clock = options.clock ?? systemClock;
  let entries: string[];
  try {
    entries = await readdir(options.spoolDir);
  } catch {
    entries = [];
  }
  const paths = entries
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((entry) => join(options.spoolDir, entry));
  let drained = 0;
  let failed = 0;

  for (const path of paths) {
    let record: HookSpoolRecord;
    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      record = HookSpoolRecordSchema.parse(raw);
    } catch {
      failed += 1;
      continue;
    }

    try {
      const receipt = await options.ingest(record.event);
      if (receipt.status === "ingested") {
        await unlink(path);
        drained += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  if (paths.length > 0) {
    const event: WosmEvent = {
      type: "hook.spoolDrained",
      at: toIsoTimestamp(clock.now()),
      drained,
      failed,
    };
    await options.persistence?.recordEvent(event, {
      source: "hook-spool",
      createdAt: event.at,
    });
    options.eventBus?.publish(event);
  }

  return {
    scanned: paths.length,
    drained,
    failed,
  };
}
