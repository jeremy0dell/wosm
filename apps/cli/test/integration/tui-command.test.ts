import { runCli, runTuiCommand } from "@wosm/cli";
import type { RunTuiOptions } from "@wosm/tui";
import { describe, expect, it } from "vitest";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("CLI tui command", () => {
  it("starts or connects the observer and hands its socket to the TUI runner", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const sockets: string[] = [];
    let running = false;
    const reconciles: string[] = [];

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
            reconcile: async (reason: string) => {
              reconciles.push(reason);
              return {
                schemaVersion: "0.3.0",
                reason,
                reconciledAt: now,
                snapshot: {
                  schemaVersion: "0.3.0",
                  generatedAt: now,
                  observer: { pid: 1234, startedAt: now, version: "0.0.0", healthy: true },
                  providerHealth: {},
                  projects: [],
                  rows: [],
                  sessions: [],
                  counts: {
                    projects: 0,
                    worktrees: 0,
                    agents: 0,
                    working: 0,
                    idle: 0,
                    attention: 0,
                    unknown: 0,
                  },
                  alerts: [],
                },
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
    expect(reconciles).toEqual(["tui-startup"]);
  });

  it("defaults bare wosm to the full TUI outside tmux", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const runOptions: unknown[] = [];
    let running = false;

    const result = await runCli(["--config", configPath], {
      env: {},
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
            reconcile: async (reason: string) => ({
              schemaVersion: "0.3.0",
              reason,
              reconciledAt: now,
              snapshot: {
                schemaVersion: "0.3.0",
                generatedAt: now,
                observer: { pid: 1234, startedAt: now, version: "0.0.0", healthy: true },
                providerHealth: {},
                projects: [],
                rows: [],
                sessions: [],
                counts: {
                  projects: 0,
                  worktrees: 0,
                  agents: 0,
                  working: 0,
                  idle: 0,
                  attention: 0,
                  unknown: 0,
                },
                alerts: [],
              },
            }),
          }) as never,
        sleep: async () => undefined,
      },
      tuiDeps: {
        runTui: async (options) => {
          runOptions.push(options);
          return { status: "exited", code: 0 };
        },
      },
    });

    expect(result).toEqual({
      code: 0,
      output: { status: "exited", code: 0 },
    });
    expect(runOptions).toEqual([{ socketPath: fixture.socketPath }]);
  });

  it("maps --popup to transient focus-and-close mode with focus origin", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const runOptions: unknown[] = [];
    let running = false;

    const result = await runCli(["--config", configPath, "tui", "--popup"], {
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
            reconcile: async (reason: string) => ({
              schemaVersion: "0.3.0",
              reason,
              reconciledAt: now,
              snapshot: {
                schemaVersion: "0.3.0",
                generatedAt: now,
                observer: { pid: 1234, startedAt: now, version: "0.0.0", healthy: true },
                providerHealth: {},
                projects: [],
                rows: [],
                sessions: [],
                counts: {
                  projects: 0,
                  worktrees: 0,
                  agents: 0,
                  working: 0,
                  idle: 0,
                  attention: 0,
                  unknown: 0,
                },
                alerts: [],
              },
            }),
          }) as never,
        sleep: async () => undefined,
      },
      tuiDeps: {
        env: {
          WOSM_FOCUS_PROVIDER: "tmux",
          WOSM_FOCUS_CLIENT_ID: "client_1",
        },
        runTui: async (options) => {
          runOptions.push(options);
          return { status: "exited", code: 0 };
        },
      },
    });

    expect(result).toEqual({
      code: 0,
      output: { status: "exited", code: 0 },
    });
    expect(runOptions).toEqual([
      {
        socketPath: fixture.socketPath,
        exitOnFocusSuccess: true,
        focusOrigin: {
          provider: "tmux",
          clientId: "client_1",
        },
      },
    ]);
  });

  it("maps --popup --persistent to popup lifecycle hooks", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const runOptions: RunTuiOptions[] = [];
    let running = false;
    let dismissed = false;
    const resolveFocusOrigin = async () => ({
      provider: "tmux",
      clientId: "client_from_option",
    });
    const onFocusSuccess = async () => {
      dismissed = true;
    };

    const result = await runCli(["--config", configPath, "tui", "--popup", "--persistent"], {
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
            reconcile: async (reason: string) => ({
              schemaVersion: "0.3.0",
              reason,
              reconciledAt: now,
              snapshot: {
                schemaVersion: "0.3.0",
                generatedAt: now,
                observer: { pid: 1234, startedAt: now, version: "0.0.0", healthy: true },
                providerHealth: {},
                projects: [],
                rows: [],
                sessions: [],
                counts: {
                  projects: 0,
                  worktrees: 0,
                  agents: 0,
                  working: 0,
                  idle: 0,
                  attention: 0,
                  unknown: 0,
                },
                alerts: [],
              },
            }),
          }) as never,
        sleep: async () => undefined,
      },
      tuiDeps: {
        popupLifecycle: {
          resolveFocusOrigin,
          onFocusSuccess,
        },
        runTui: async (options) => {
          runOptions.push(options);
          return { status: "exited", code: 0 };
        },
      },
    });

    expect(result).toEqual({
      code: 0,
      output: { status: "exited", code: 0 },
    });
    expect(runOptions).toHaveLength(1);
    expect(runOptions[0]).toMatchObject({
      socketPath: fixture.socketPath,
      persistentPopup: true,
      resolveFocusOrigin,
      onFocusSuccess,
    });
    await expect(runOptions[0]?.resolveFocusOrigin?.()).resolves.toEqual({
      provider: "tmux",
      clientId: "client_from_option",
    });
    await runOptions[0]?.onFocusSuccess?.();
    expect(dismissed).toBe(true);
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
