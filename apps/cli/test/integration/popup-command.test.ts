import { fileURLToPath } from "node:url";
import { runCli, runPopupCommand } from "@wosm/cli";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

describe("CLI popup command", () => {
  it("opens a tmux popup for the TUI client path", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      runPopupCommand([], {
        env: {
          TMUX: "/tmp/tmux-501/default,123,0",
        },
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "display-message") {
            return result(input, "client_1\n");
          }
          return result(input);
        },
      }),
    ).resolves.toMatchObject({ opened: true });

    expect(calls[0]).toMatchObject({
      command: "tmux",
      args: ["display-message", "-p", "#{client_name}"],
    });
    const popupCall = calls.find(
      (call) => call.args?.[0] === "display-popup" && call.args.includes("-E"),
    );
    expect(popupCall).toMatchObject({
      command: "tmux",
      args: expect.arrayContaining([
        "display-popup",
        "-c",
        "client_1",
        "-w",
        "95%",
        "-h",
        "85%",
        "-E",
        expect.stringContaining("WOSM_FOCUS_CLIENT_ID=client_1"),
      ]),
    });
  });

  it("routes runCli popup through global --config parsing", async () => {
    const fixture = await createTempState();
    fixture.config.defaults.terminal = "tmux";
    fixture.config.terminal = {
      tmux: {
        popupWidth: "90%",
        popupHeight: "80%",
        popupPosition: "C",
      },
    };
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const calls: ExternalCommandInput[] = [];

    await expect(
      runCli(["--config", configPath, "popup"], {
        popupDeps: {
          env: {
            TMUX: "/tmp/tmux-501/default,123,0",
          },
          runner: async (input) => {
            calls.push(input);
            if (input.args?.[0] === "display-message") {
              return result(input, "client_1\n");
            }
            return result(input);
          },
        },
      }),
    ).resolves.toMatchObject({
      code: 0,
      output: { opened: true },
    });

    const popupCall = calls.find(
      (call) => call.args?.[0] === "display-popup" && call.args.includes("-E"),
    );
    expect(popupCall?.args).toEqual([
      "display-popup",
      "-c",
      "client_1",
      "-w",
      "90%",
      "-h",
      "80%",
      "-E",
      expect.stringContaining("WOSM_FOCUS_CLIENT_ID=client_1"),
    ]);
  });

  it("uses the current CLI entrypoint for popup TUI launches", async () => {
    const fixture = await createTempState();
    fixture.config.defaults.terminal = "tmux";
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const calls: ExternalCommandInput[] = [];

    await expect(
      runCli(["--config", configPath, "popup"], {
        popupDeps: {
          env: {},
          runner: async (input) => {
            calls.push(input);
            return result(input);
          },
        },
      }),
    ).resolves.toMatchObject({
      code: 0,
      output: { opened: true },
    });

    const popupCall = calls.find(
      (call) => call.args?.[0] === "display-popup" && call.args.includes("-E"),
    );
    expect(popupCall?.args).toEqual([
      "display-popup",
      "-w",
      "95%",
      "-h",
      "85%",
      "-E",
      [
        "env",
        "WOSM_TUI_POPUP=1",
        "WOSM_FOCUS_PROVIDER=tmux",
        shellQuote(process.execPath),
        shellQuote(fileURLToPath(new URL("../../src/main.ts", import.meta.url))),
        "tui",
        "--popup",
      ].join(" "),
    ]);
  });

  it("defaults bare wosm to the popup command when invoked from tmux", async () => {
    const fixture = await createTempState();
    fixture.config.defaults.terminal = "tmux";
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    const calls: ExternalCommandInput[] = [];

    await expect(
      runCli(["--config", configPath], {
        popupDeps: {
          env: {
            TMUX: "/tmp/tmux-501/default,123,0",
          },
          runner: async (input) => {
            calls.push(input);
            if (input.args?.[0] === "display-message") {
              return result(input, "client_1\n");
            }
            return result(input);
          },
        },
      }),
    ).resolves.toMatchObject({
      code: 0,
      output: { opened: true },
    });

    expect(calls.some((call) => call.args?.[0] === "display-popup")).toBe(true);
  });
});

function result(input: ExternalCommandInput, stdout = ""): ExternalCommandResult {
  return {
    command: input.command,
    args: input.args ?? [],
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
