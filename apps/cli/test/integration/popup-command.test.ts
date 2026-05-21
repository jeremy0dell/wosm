import { runCli, runPopupCommand } from "@wosm/cli";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

describe("CLI popup command", () => {
  it("opens a tmux popup for the TUI client path", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      runPopupCommand([], {
        runner: async (input) => {
          calls.push(input);
          return result(input);
        },
      }),
    ).resolves.toMatchObject({ opened: true });

    expect(calls[0]).toMatchObject({
      command: "tmux",
      args: ["display-popup", "-w", "95%", "-h", "85%", "-E", "wosm tui --popup"],
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

    expect(calls[0]?.args).toEqual([
      "display-popup",
      "-w",
      "90%",
      "-h",
      "80%",
      "-E",
      "wosm tui --popup",
    ]);
  });
});

function result(input: ExternalCommandInput): ExternalCommandResult {
  return {
    command: input.command,
    args: input.args ?? [],
    stdout: "",
    stderr: "",
    exitCode: 0,
  };
}
