import { runCli, runTuiCommand } from "@wosm/cli";
import { describe, expect, it } from "vitest";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("CLI tui command", () => {
  it("starts or connects the observer and hands its socket to the TUI runner", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const sockets: string[] = [];
    let running = false;

    const result = await runCli(["--config", configPath, "tui"], {
      observerDeps: {
        spawnObserver: async () => {
          running = true;
          return { pid: 1234, unref: () => undefined };
        },
        clientFactory: () =>
          ({
            health: async () => {
              if (!running) throw new Error("stopped");
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
      tuiDeps: {
        runTui: async (options) => {
          sockets.push(options.socketPath);
          return { status: "exited", code: 0 };
        },
      },
    });

    expect(result).toEqual({
      code: 0,
      output: { status: "exited", code: 0 },
    });
    expect(sockets).toEqual([fixture.socketPath]);
  });

  it("returns a nonzero result when observer startup is unavailable", async () => {
    const fixture = await createTempState();
    const result = await runTuiCommand(
      [],
      { config: fixture.config, timeoutMs: 1 },
      {
        observer: {
          spawnObserver: async () => ({ pid: 1234, unref: () => undefined }),
          clientFactory: () =>
            ({
              health: async () => {
                throw new Error("still down");
              },
            }) as never,
          sleep: async () => undefined,
        },
        runTui: async () => {
          throw new Error("TUI should not run when observer is unavailable.");
        },
      },
    );

    expect(result).toMatchObject({
      status: "unavailable",
      code: 1,
    });
  });
});
