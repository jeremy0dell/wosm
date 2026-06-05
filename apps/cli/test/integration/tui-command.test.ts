import { writeFile } from "node:fs/promises";
import { runCli } from "@wosm/cli";
import { runTuiCommand } from "@wosm/cli/internal";
import type { TuiConfig } from "@wosm/config";
import type { RunTuiOptions } from "@wosm/tui";
import { describe, expect, it } from "vitest";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";
const tuiConfig: TuiConfig = {
  widgets: [
    {
      type: "time",
      timeFormat: "12h",
    },
    {
      type: "weather",
      city: "New York, NY",
      label: "NYC",
      temperatureUnit: "fahrenheit",
      refreshIntervalMinutes: 15,
    },
  ],
};

describe("CLI tui command", () => {
  it("starts or connects the observer and hands its socket to the TUI runner", async () => {
    const fixture = await createTempState();
    fixture.config.tui = tuiConfig;
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const runOptions: RunTuiOptions[] = [];
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
                schemaVersion: "0.4.0",
                status: "healthy",
                pid: 1234,
                startedAt: now,
                version: "0.0.0",
              };
            },
            reconcile: async (reason: string) => {
              reconciles.push(reason);
              return {
                schemaVersion: "0.4.0",
                reason,
                reconciledAt: now,
                snapshot: {
                  schemaVersion: "0.4.0",
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
        tuiConfig,
      },
    ]);
    expect(reconciles).toEqual(["tui-startup"]);
  });

  it("defaults bare wosm to the full TUI outside tmux", async () => {
    const fixture = await createTempState();
    fixture.config.tui = tuiConfig;
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const runOptions: RunTuiOptions[] = [];
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
                schemaVersion: "0.4.0",
                status: "healthy",
                pid: 1234,
                startedAt: now,
                version: "0.0.0",
              };
            },
            reconcile: async (reason: string) => ({
              schemaVersion: "0.4.0",
              reason,
              reconciledAt: now,
              snapshot: {
                schemaVersion: "0.4.0",
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
    expect(runOptions).toEqual([{ socketPath: fixture.socketPath, tuiConfig }]);
  });

  it("maps --popup to transient focus-and-close mode with focus origin", async () => {
    const fixture = await createTempState();
    fixture.config.tui = tuiConfig;
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const runOptions: RunTuiOptions[] = [];
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
                schemaVersion: "0.4.0",
                status: "healthy",
                pid: 1234,
                startedAt: now,
                version: "0.0.0",
              };
            },
            reconcile: async (reason: string) => ({
              schemaVersion: "0.4.0",
              reason,
              reconciledAt: now,
              snapshot: {
                schemaVersion: "0.4.0",
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
        tuiConfig,
        exitOnFocusSuccess: true,
        focusOrigin: {
          provider: "tmux",
          clientId: "client_1",
        },
      },
    ]);
  });

  it("does not block popup TUI startup on observer reconcile", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const runOptions: unknown[] = [];
    const reconciles: string[] = [];
    let running = false;

    const result = await expectWithin(
      runCli(["--config", configPath, "tui", "--popup"], {
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
                  schemaVersion: "0.4.0",
                  status: "healthy",
                  pid: 1234,
                  startedAt: now,
                  version: "0.0.0",
                };
              },
              reconcile: (reason: string) => {
                reconciles.push(reason);
                return new Promise(() => undefined);
              },
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
      }),
      100,
    );

    expect(result).toEqual({
      code: 0,
      output: { status: "exited", code: 0 },
    });
    expect(runOptions).toHaveLength(1);
    expect(reconciles).toEqual([]);
  });

  it("maps --popup --persistent to popup lifecycle hooks", async () => {
    const fixture = await createTempState();
    fixture.config.tui = tuiConfig;
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const runOptions: RunTuiOptions[] = [];
    let running = false;
    let dismissed = false;
    let closed = false;
    const resolveFocusOrigin = async () => ({
      provider: "tmux",
      clientId: "client_from_option",
    });
    const onFocusSuccess = async () => {
      dismissed = true;
    };
    const onDismiss = async () => {
      closed = true;
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
                schemaVersion: "0.4.0",
                status: "healthy",
                pid: 1234,
                startedAt: now,
                version: "0.0.0",
              };
            },
            reconcile: async (reason: string) => ({
              schemaVersion: "0.4.0",
              reason,
              reconciledAt: now,
              snapshot: {
                schemaVersion: "0.4.0",
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
          onDismiss,
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
      tuiConfig,
      persistentPopup: true,
      resolveFocusOrigin,
      onFocusSuccess,
      onDismiss,
    });
    await expect(runOptions[0]?.resolveFocusOrigin?.()).resolves.toEqual({
      provider: "tmux",
      clientId: "client_from_option",
    });
    await runOptions[0]?.onFocusSuccess?.();
    expect(dismissed).toBe(true);
    await runOptions[0]?.onDismiss?.();
    expect(closed).toBe(true);
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

  it("runs a fake dashboard without observer startup or startup reconcile", async () => {
    const fixture = await createTempState();
    fixture.config.tui = tuiConfig;
    const runOptions: RunTuiOptions[] = [];

    const result = await runTuiCommand(
      ["--dev-fake-dashboard", "--fake-projects", "3", "--fake-worktrees-per-project", "5"],
      { config: fixture.config },
      {
        observer: {
          spawnObserver: async () => {
            throw new Error("observer should not start for fake dashboard mode");
          },
          clientFactory: () =>
            ({
              reconcile: async () => {
                throw new Error("startup reconcile should not run for fake dashboard mode");
              },
            }) as never,
        },
        runTui: async (options) => {
          runOptions.push(options);
          return { status: "exited", code: 0 };
        },
      },
    );

    expect(result).toEqual({ status: "exited", code: 0 });
    expect(runOptions).toHaveLength(1);
    expect(runOptions[0]?.socketPath).toBeUndefined();
    expect(runOptions[0]?.tuiConfig).toEqual(tuiConfig);
    expect(runOptions[0]?.service).toBeDefined();
    expect(runOptions[0]?.initialSnapshot?.projects).toHaveLength(3);
    expect(runOptions[0]?.initialSnapshot?.rows).toHaveLength(15);
  });

  it("rejects invalid widget config before starting the TUI", async () => {
    const fixture = await createTempState();
    const configPath = `${fixture.root}/invalid-widget-config.toml`;
    await writeFile(
      configPath,
      [
        "schema_version = 1",
        "projects = []",
        "",
        "[defaults]",
        'worktree_provider = "fake-worktree"',
        'terminal = "fake-terminal"',
        'harness = "fake-harness"',
        'layout = "agent-shell"',
        "",
        "[observer]",
        `socket_path = ${JSON.stringify(fixture.socketPath)}`,
        `state_dir = ${JSON.stringify(fixture.stateDir)}`,
        "",
        "[[tui.widgets]]",
        'type = "weather"',
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(
      runCli(["--config", configPath, "tui"], {
        observerDeps: {
          spawnObserver: async () => {
            throw new Error("observer should not start for invalid widget config");
          },
        },
        tuiDeps: {
          runTui: async () => {
            throw new Error("TUI should not start for invalid widget config");
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "CONFIG_VALIDATION_FAILED",
    });
  });

  it("rejects invalid fake dashboard count flags before observer startup", async () => {
    const fixture = await createTempState();

    await expect(
      runTuiCommand(
        ["--dev-fake-dashboard", "--fake-projects", "0"],
        { config: fixture.config },
        {
          observer: {
            spawnObserver: async () => {
              throw new Error("observer should not start for invalid fake dashboard input");
            },
          },
        },
      ),
    ).rejects.toThrow("--fake-projects must be a positive integer.");

    await expect(
      runTuiCommand(
        ["--dev-fake-dashboard", "--fake-worktrees-per-project"],
        { config: fixture.config },
        {
          observer: {
            spawnObserver: async () => {
              throw new Error("observer should not start for invalid fake dashboard input");
            },
          },
        },
      ),
    ).rejects.toThrow("--fake-worktrees-per-project requires a value.");

    await expect(
      runTuiCommand(
        ["--fake-projects", "3"],
        { config: fixture.config },
        {
          observer: {
            spawnObserver: async () => {
              throw new Error("observer should not start for invalid fake dashboard input");
            },
          },
        },
      ),
    ).rejects.toThrow("--fake-projects requires --dev-fake-dashboard.");
  });

  it("rejects invalid TUI timeout values before observer startup", async () => {
    const fixture = await createTempState();

    await expect(
      runTuiCommand(
        ["--timeout-ms", "-1"],
        { config: fixture.config },
        {
          observer: {
            spawnObserver: async () => {
              throw new Error("observer should not start for invalid timeout input");
            },
          },
        },
      ),
    ).rejects.toThrow("--timeout-ms must be a positive integer.");
  });
});

async function expectWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
