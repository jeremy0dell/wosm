import type { CommandId, CommandRecord, WosmSnapshot } from "@wosm/contracts";
import { createObserverClient, type ObserverApi, type ObserverClient } from "@wosm/protocol";
import type { RealWosmConfigFixture } from "./config";

export function createRealObserverClient(
  config: RealWosmConfigFixture,
  timeoutMs = 30_000,
): ObserverClient {
  return createObserverClient({ socketPath: config.socketPath, timeoutMs });
}

export async function waitForCommandRecord(
  client: ObserverClient,
  commandId: CommandId,
  options: { timeoutMs?: number; allowFailed?: boolean } = {},
): Promise<CommandRecord> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const command = await client.waitForCommand(commandId, { timeoutMs });
  if (command.status === "failed" && options.allowFailed !== true) {
    throw new Error(`Command ${commandId} failed: ${command.error?.code ?? "unknown"}`);
  }
  return command;
}

export async function waitForSnapshot(
  client: ObserverApi,
  predicate: (snapshot: WosmSnapshot) => boolean,
  message: string,
  timeoutMs = 60_000,
): Promise<WosmSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const snapshot = await client.getSnapshot({ includeDebug: true });
    if (predicate(snapshot)) {
      return snapshot;
    }
    await client.reconcile("real-e2e-poll").catch(() => undefined);
    await delay(500);
  }
  throw new Error(message);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
