import { type ChildProcessLike, getObserverStatus, startObserver } from "@wosm/cli";
import { describe, expect, it } from "vitest";
import { createStaleSocketFile } from "../../../../tests/support/sockets";
import { fileExists } from "../../../../tests/support/spool";
import { createTempState } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("CLI observer process helpers", () => {
  it("maps stale sockets distinctly from stopped observers", async () => {
    const fixture = await createTempState();
    await createStaleSocketFile(fixture.socketPath);

    await expect(
      getObserverStatus({
        config: fixture.config,
      }),
    ).resolves.toMatchObject({
      status: "stale",
      paths: {
        socketPath: fixture.socketPath,
      },
    });
  });

  it("spawns the observer and waits for health when it is stopped", async () => {
    const fixture = await createTempState();
    let spawned = false;
    let healthAttempts = 0;

    const result = await startObserver(
      {
        config: fixture.config,
        timeoutMs: 200,
      },
      {
        clock: { now: () => new Date(now) },
        spawnObserver: async (): Promise<ChildProcessLike> => {
          spawned = true;
          return { pid: 1234, unref: () => undefined };
        },
        clientFactory: () =>
          ({
            health: async () => {
              healthAttempts += 1;
              if (healthAttempts === 1) {
                throw new Error("not yet");
              }
              return {
                schemaVersion: "0.3.0",
                status: "healthy",
                pid: 1234,
                startedAt: now,
                version: "0.0.0",
              };
            },
          }) as never,
        sleep: async () => undefined,
      },
    );

    expect(spawned).toBe(true);
    expect(result).toMatchObject({
      status: "running",
      health: {
        status: "healthy",
      },
    });
  });

  it("removes a stale socket before spawning the observer", async () => {
    const fixture = await createTempState();
    await createStaleSocketFile(fixture.socketPath);
    let spawned = false;

    const result = await startObserver(
      {
        config: fixture.config,
        timeoutMs: 200,
      },
      {
        clock: { now: () => new Date(now) },
        spawnObserver: async (): Promise<ChildProcessLike> => {
          spawned = true;
          return { pid: 1234, unref: () => undefined };
        },
        clientFactory: () =>
          ({
            health: async () => {
              if (!spawned) {
                throw new Error("not running");
              }
              return {
                schemaVersion: "0.3.0",
                status: "healthy",
                pid: 1234,
                startedAt: now,
                version: "0.0.0",
              };
            },
          }) as never,
        sleep: async () => undefined,
      },
    );

    expect(spawned).toBe(true);
    expect(result.status).toBe("running");
    await expect(fileExists(fixture.socketPath)).resolves.toBe(false);
  });

  it("returns a safe startup error when health does not arrive before timeout", async () => {
    const fixture = await createTempState();
    let spawned = false;

    const result = await startObserver(
      {
        config: fixture.config,
        timeoutMs: 20,
      },
      {
        clock: { now: () => new Date(now) },
        spawnObserver: async (): Promise<ChildProcessLike> => {
          spawned = true;
          return { pid: 1234, unref: () => undefined };
        },
        clientFactory: () =>
          ({
            health: async () => {
              throw new Error("raw process failure\n    at internal-frame");
            },
          }) as never,
        sleep: async () => new Promise((resolve) => setTimeout(resolve, 1)),
      },
    );

    expect(spawned).toBe(true);
    expect(result).toMatchObject({
      status: "unhealthy",
      error: {
        tag: "ObserverStartupError",
      },
    });
    expect(result.error?.message).not.toContain("internal-frame");
  });
});
