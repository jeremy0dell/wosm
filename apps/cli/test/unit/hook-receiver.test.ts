import { join } from "node:path";
import { receiveHookEvent } from "@wosm/cli";
import type { HookReceipt } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { fileMode, listHookSpoolFiles, readHookSpoolRecord } from "../../../../tests/support/spool";
import { createTempState } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("CLI hook receiver", () => {
  it("delivers hook events online without spooling", async () => {
    const fixture = await createTempState();

    const receipt = await receiveHookEvent(
      {
        provider: "worktrunk",
        event: "worktree.created",
        config: fixture.config,
      },
      {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            ingestHookEvent: async (event): Promise<HookReceipt> => ({
              schemaVersion: "0.3.0",
              hookId: "hook_1",
              provider: event.provider,
              event: event.event,
              accepted: true,
              status: "ingested",
              receivedAt: event.receivedAt,
              reconciled: true,
            }),
          }) as never,
      },
    );

    expect(receipt.status).toBe("ingested");
    await expect(listHookSpoolFiles(fixture.hookSpoolDir)).resolves.toEqual([]);
  });

  it("auto-starts a stopped observer and retries delivery", async () => {
    const fixture = await createTempState();
    let attempts = 0;
    let started = false;

    const receipt = await receiveHookEvent(
      {
        provider: "worktrunk",
        event: "worktree.created",
        config: fixture.config,
        rateLimitMs: 0,
      },
      {
        clock: { now: () => new Date(now) },
        spawnObserver: async () => {
          started = true;
          return { pid: 1234, unref: () => undefined };
        },
        clientFactory: () =>
          ({
            health: async () => {
              if (!started) {
                throw new Error("stopped");
              }
              return {
                schemaVersion: "0.3.0",
                status: "healthy",
                pid: 1234,
                startedAt: now,
                version: "0.0.0",
              };
            },
            ingestHookEvent: async (event): Promise<HookReceipt> => {
              attempts += 1;
              if (attempts === 1) {
                throw new Error("offline");
              }
              return {
                schemaVersion: "0.3.0",
                hookId: "hook_1",
                provider: event.provider,
                event: event.event,
                accepted: true,
                status: "ingested",
                receivedAt: event.receivedAt,
                reconciled: true,
              };
            },
          }) as never,
        sleep: async () => undefined,
      },
    );

    expect(started).toBe(true);
    expect(receipt.status).toBe("ingested");
    expect(attempts).toBe(2);
  });

  it("spools with a safe error when online delivery times out", async () => {
    const fixture = await createTempState();

    const receipt = await receiveHookEvent(
      {
        provider: "worktrunk",
        event: "worktree.created",
        config: {
          ...fixture.config,
          observer: {
            ...fixture.config.observer,
            autoStartFromHooks: false,
          },
        },
        deliveryTimeoutMs: 5,
      },
      {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            ingestHookEvent: async () => new Promise<HookReceipt>(() => undefined),
          }) as never,
      },
    );

    expect(receipt).toMatchObject({
      status: "spooled",
      error: {
        tag: "HookDeliveryError",
        code: "HOOK_DELIVERY_FAILED",
      },
    });
    expect(receipt.error?.message).not.toContain(" at ");
    const files = await listHookSpoolFiles(fixture.hookSpoolDir);
    expect(files).toHaveLength(1);
    const record = await readHookSpoolRecord(fixture.hookSpoolDir, files[0] ?? "");
    expect(record.lastError).toMatchObject({ code: "HOOK_DELIVERY_FAILED" });
    await expect(fileMode(fixture.hookSpoolDir)).resolves.toBe(0o700);
    await expect(fileMode(join(fixture.hookSpoolDir, files[0] ?? ""))).resolves.toBe(0o600);
  });

  it("spools when observer auto-start times out", async () => {
    const fixture = await createTempState();
    let spawned = false;

    const receipt = await receiveHookEvent(
      {
        provider: "worktrunk",
        event: "worktree.created",
        config: fixture.config,
        startupTimeoutMs: 20,
        rateLimitMs: 0,
      },
      {
        clock: { now: () => new Date(now) },
        spawnObserver: async () => {
          spawned = true;
          return { pid: 1234, unref: () => undefined };
        },
        clientFactory: () =>
          ({
            health: async () => {
              throw new Error("observer never became healthy\n    at raw-stack");
            },
            ingestHookEvent: async () => {
              throw new Error("offline");
            },
          }) as never,
        sleep: async () => new Promise((resolve) => setTimeout(resolve, 1)),
      },
    );

    expect(spawned).toBe(true);
    expect(receipt.status).toBe("spooled");
    expect(receipt.error).toMatchObject({ tag: "ObserverStartupError" });
    expect(receipt.error?.message).not.toContain("raw-stack");
  });

  it("spools when auto-start is disabled", async () => {
    const fixture = await createTempState();
    const receipt = await receiveHookEvent(
      {
        provider: "worktrunk",
        event: "worktree.created",
        config: {
          ...fixture.config,
          observer: {
            ...fixture.config.observer,
            autoStartFromHooks: false,
          },
        },
      },
      {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            ingestHookEvent: async () => {
              throw new Error("offline");
            },
          }) as never,
      },
    );

    expect(receipt.status).toBe("spooled");
    const files = await listHookSpoolFiles(join(fixture.stateDir, "spool", "hooks"));
    expect(files).toHaveLength(1);
    await expect(
      readHookSpoolRecord(join(fixture.stateDir, "spool", "hooks"), files[0] ?? ""),
    ).resolves.toMatchObject({
      event: {
        provider: "worktrunk",
        event: "worktree.created",
      },
    });
  });

  it("rate-limits repeated auto-start attempts and spools without spawning again", async () => {
    const fixture = await createTempState();
    let started = false;
    let spawnCount = 0;

    const deps = {
      clock: { now: () => new Date(now) },
      spawnObserver: async () => {
        spawnCount += 1;
        started = true;
        return { pid: 1234, unref: () => undefined };
      },
      clientFactory: () =>
        ({
          health: async () => {
            if (!started) {
              throw new Error("stopped");
            }
            return {
              schemaVersion: "0.3.0",
              status: "healthy",
              pid: 1234,
              startedAt: now,
              version: "0.0.0",
            };
          },
          ingestHookEvent: async () => {
            throw new Error("offline");
          },
        }) as never,
      sleep: async () => undefined,
    };

    await expect(
      receiveHookEvent(
        {
          provider: "worktrunk",
          event: "worktree.created",
          config: fixture.config,
          rateLimitMs: 1000,
        },
        deps,
      ),
    ).resolves.toMatchObject({ status: "spooled" });

    await expect(
      receiveHookEvent(
        {
          provider: "worktrunk",
          event: "worktree.updated",
          config: fixture.config,
          rateLimitMs: 1000,
        },
        deps,
      ),
    ).resolves.toMatchObject({
      status: "spooled",
      error: {
        code: "HOOK_AUTOSTART_RATE_LIMITED",
      },
    });
    expect(spawnCount).toBe(1);
  });
});
