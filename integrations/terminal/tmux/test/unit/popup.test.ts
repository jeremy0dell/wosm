import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { buildTmuxPopupArgs, openTmuxPopup } from "../../src/popup";

describe("tmux popup", () => {
  it("builds a direct TUI popup command from config defaults", () => {
    expect(buildTmuxPopupArgs()).toEqual([
      "display-popup",
      "-w",
      "95%",
      "-h",
      "85%",
      "-E",
      "wosm tui --popup",
    ]);
  });

  it("runs tmux display-popup through the external command boundary", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      openTmuxPopup({
        runner: async (input) => {
          calls.push(input);
          return result(input);
        },
        config: {
          popupWidth: "90%",
          popupHeight: "80%",
          popupPosition: "C",
        },
      }),
    ).resolves.toMatchObject({ opened: true });

    expect(calls).toEqual([
      expect.objectContaining({
        command: "tmux",
        args: ["display-popup", "-w", "90%", "-h", "80%", "-E", "wosm tui --popup"],
      }),
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
