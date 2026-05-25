import { fileURLToPath } from "node:url";
import type { ObserverProcessDeps } from "@wosm/cli";
import { runCli, runPopupCommand, shouldSuppressCliProcessOutput } from "@wosm/cli";
import type { TmuxPopupOptions } from "@wosm/tmux";
import { describe, expect, it } from "vitest";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("CLI popup command", () => {
  it("delegates popup opening to the tmux integration", async () => {
    const fixture = await createTempState();
    fixture.config.defaults.terminal = "tmux";
    fixture.config.terminal = {
      tmux: {
        popupWidth: "90%",
        popupHeight: "80%",
        popupPosition: "C",
      },
    };
    const calls: TmuxPopupOptions[] = [];
    const reconciles: string[] = [];

    await expect(
      runPopupCommand(
        [],
        {
          config: fixture.config,
          env: {
            TMUX: "/tmp/tmux-501/default,123,0",
          },
          tuiCommand: "node wosm tui --popup --persistent",
        },
        {
          observer: runningObserverDeps(reconciles),
          openTmuxPopup: async (options) => {
            calls.push(options);
            return { opened: true };
          },
        },
      ),
    ).resolves.toEqual({ opened: true });

    expect(reconciles).toEqual(["popup-open"]);
    expect(calls).toEqual([
      {
        config: {
          popupWidth: "90%",
          popupHeight: "80%",
          popupPosition: "C",
        },
        enterWorkbench: false,
        env: {
          TMUX: "/tmp/tmux-501/default,123,0",
        },
        tuiCommand: "node wosm tui --popup --persistent",
      },
    ]);
  });

  it("routes runCli popup through global --config parsing", async () => {
    const fixture = await createTempState();
    fixture.config.defaults.terminal = "tmux";
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const calls: TmuxPopupOptions[] = [];
    const reconciles: string[] = [];

    await expect(
      runCli(["--config", configPath, "popup"], {
        observerDeps: runningObserverDeps(reconciles),
        popupDeps: {
          env: {
            TMUX: "/tmp/tmux-501/default,123,0",
          },
          openTmuxPopup: async (options) => {
            calls.push(options);
            return { opened: true };
          },
        },
      }),
    ).resolves.toEqual({
      code: 0,
      output: { opened: true },
    });

    expect(reconciles).toEqual(["popup-open"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      env: {
        TMUX: "/tmp/tmux-501/default,123,0",
      },
    });
    expect(calls[0]?.tuiCommand).toContain("--config");
    expect(calls[0]?.tuiCommand).toContain(shellQuote(configPath));
    expect(calls[0]?.tuiCommand).toContain("tui --popup --persistent");
    expect(calls[0]?.tuiCommand).toContain(
      shellQuote(fileURLToPath(new URL("../../src/main.ts", import.meta.url))),
    );
  });

  it("defaults bare wosm to the popup command when invoked from tmux", async () => {
    const fixture = await createTempState();
    fixture.config.defaults.terminal = "tmux";
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const calls: TmuxPopupOptions[] = [];
    const reconciles: string[] = [];

    await expect(
      runCli(["--config", configPath], {
        observerDeps: runningObserverDeps(reconciles),
        popupDeps: {
          env: {
            TMUX: "/tmp/tmux-501/default,123,0",
          },
          openTmuxPopup: async (options) => {
            calls.push(options);
            return { opened: true };
          },
        },
      }),
    ).resolves.toEqual({
      code: 0,
      output: { opened: true },
    });

    expect(reconciles).toEqual(["popup-open"]);
    expect(calls).toHaveLength(1);
  });

  it("rejects popup when the configured terminal provider is not tmux", async () => {
    const fixture = await createTempState();
    fixture.config.defaults.terminal = "ghostty";

    await expect(runPopupCommand([], { config: fixture.config })).rejects.toThrow(
      "Popup is only implemented for tmux, not ghostty.",
    );
  });

  it("suppresses explicit popup command JSON in the interactive CLI process", () => {
    expect(shouldSuppressCliProcessOutput(["popup"])).toBe(true);
    expect(shouldSuppressCliProcessOutput(["popup", "--config", "/tmp/config.toml"])).toBe(true);
    expect(shouldSuppressCliProcessOutput([])).toBe(true);
    expect(shouldSuppressCliProcessOutput(["tui"])).toBe(true);
    expect(shouldSuppressCliProcessOutput(["doctor"])).toBe(false);
  });
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runningObserverDeps(reconciles: string[]): ObserverProcessDeps {
  return {
    clientFactory: () =>
      ({
        health: async () => ({
          schemaVersion: "0.3.0",
          status: "healthy",
          pid: 1234,
          startedAt: now,
          version: "0.0.0",
        }),
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
  };
}
