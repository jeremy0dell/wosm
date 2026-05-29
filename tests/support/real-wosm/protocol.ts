import type { CommandId, CommandRecord, WosmSnapshot } from "@wosm/contracts";
import { createObserverClient, type ObserverApi } from "@wosm/protocol";
import type { RealWosmConfigFixture } from "./config";

export function createRealObserverClient(
  config: RealWosmConfigFixture,
  timeoutMs = 30_000,
): ObserverApi {
  return createObserverClient({ socketPath: config.socketPath, timeoutMs });
}

export async function waitForCommandRecord(
  client: ObserverApi,
  commandId: CommandId,
  options: { timeoutMs?: number; allowFailed?: boolean } = {},
): Promise<CommandRecord> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const command = await client.getCommand(commandId);
    if (command?.status === "succeeded") {
      return command;
    }
    if (command?.status === "failed") {
      if (options.allowFailed === true) {
        return command;
      }
      throw new Error(`Command ${commandId} failed: ${command.error?.code ?? "unknown"}`);
    }
    await delay(250);
  }
  throw new Error(`Command ${commandId} did not finish within ${timeoutMs}ms.`);
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
    await client.reconcile("real-dogfood-poll").catch(() => undefined);
    await delay(500);
  }
  throw new Error(message);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
