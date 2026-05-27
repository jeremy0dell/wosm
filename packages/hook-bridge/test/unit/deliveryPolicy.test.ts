import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  HookPayloadSummary,
  HookReceipt,
  ProviderHookEvent,
  SafeError,
} from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { deliverProviderHookWithSpooling } from "../../src/deliveryPolicy";
import type { ObserverPaths } from "../../src/paths";

const now = "2026-05-20T12:00:00.000Z";

describe("hook bridge delivery policy", () => {
  it("returns the first delivered receipt without startup or spooling", async () => {
    let attempts = 0;
    let spooled = false;

    const receipt = await deliverProviderHookWithSpooling({
      paths: paths(),
      event: event(),
      payloadSummary: payloadSummary(),
      autoStart: true,
      startupTimeoutMs: 50,
      rateLimitMs: 0,
      deps: {
        clock: { now: () => new Date(now) },
        spawnObserver: async () => {
          throw new Error("observer should not start");
        },
      },
      deliver: async () => {
        attempts += 1;
        return { receipt: hookReceipt("ingested") };
      },
      spoolReceipt: async () => {
        spooled = true;
        return hookReceipt("spooled");
      },
    });

    expect(receipt.status).toBe("ingested");
    expect(attempts).toBe(1);
    expect(spooled).toBe(false);
  });

  it("starts the observer, retries delivery, and spools after retry failure", async () => {
    let attempts = 0;
    let healthCalls = 0;
    let spawns = 0;
    let spoolError: SafeError | undefined;

    const receipt = await deliverProviderHookWithSpooling({
      paths: paths(),
      event: event(),
      payloadSummary: payloadSummary(),
      autoStart: true,
      startupTimeoutMs: 50,
      rateLimitMs: 0,
      deps: {
        clock: { now: () => new Date(now) },
        sleep: async () => undefined,
        clientFactory: () =>
          ({
            health: async () => {
              healthCalls += 1;
              if (healthCalls === 1) {
                throw new Error("offline");
              }
              return {
                schemaVersion: "0.3.0",
                status: "healthy",
                checkedAt: now,
                providers: [],
              };
            },
          }) as never,
        spawnObserver: async () => {
          spawns += 1;
          return { pid: 1234, unref: () => undefined };
        },
      },
      deliver: async () => {
        attempts += 1;
        return { error: safeError(`OFFLINE_${attempts}`) };
      },
      spoolReceipt: async (error) => {
        spoolError = error;
        return hookReceipt("spooled");
      },
    });

    expect(receipt.status).toBe("spooled");
    expect(attempts).toBe(2);
    expect(spawns).toBe(1);
    expect(spoolError?.code).toBe("OFFLINE_2");
  });
});

function event(): ProviderHookEvent {
  return {
    schemaVersion: "0.3.0",
    hookId: "hook_1",
    provider: "fake-harness",
    kind: "harness",
    event: "event.updated",
    receivedAt: now,
  };
}

function payloadSummary(): HookPayloadSummary {
  return {
    present: false,
    originalBytes: null,
    compactedBytes: null,
    compacted: false,
    omittedFieldNames: [],
  };
}

function hookReceipt(status: HookReceipt["status"]): HookReceipt {
  return {
    schemaVersion: "0.3.0",
    hookId: "hook_1",
    provider: "fake-harness",
    event: "event.updated",
    accepted: status === "ingested" || status === "spooled",
    status,
    receivedAt: now,
  };
}

function safeError(code: string): SafeError {
  return {
    tag: "HookDeliveryError",
    code,
    message: "Delivery failed.",
  };
}

function paths(): ObserverPaths {
  const stateDir = join("/tmp", `wosm-hook-delivery-policy-${randomUUID()}`);
  return {
    stateDir,
    socketPath: join(stateDir, "run", "observer.sock"),
    dbPath: join(stateDir, "observer.sqlite"),
    logDir: join(stateDir, "logs"),
    diagnosticsDir: join(stateDir, "diagnostics"),
    hookSpoolDir: join(stateDir, "spool", "hooks"),
  };
}
