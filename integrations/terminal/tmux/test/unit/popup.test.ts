import { setTimeout as sleep } from "node:timers/promises";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { buildTmuxPopupArgs, openTmuxPopup } from "../../src/popup";

describe("tmux popup", () => {
  it("builds a direct TUI popup command from config defaults", () => {
    expect(buildTmuxPopupArgs()).toEqual([
      "display-popup",
      "-w",
      "50%",
      "-h",
      "50%",
      "-E",
      "env WOSM_TUI_POPUP=1 WOSM_FOCUS_PROVIDER=tmux wosm tui --popup",
    ]);
  });

  it("adds a resolved tmux client id to the popup TUI command", () => {
    expect(buildTmuxPopupArgs({ focusClientId: "client_1" })).toEqual([
      "display-popup",
      "-c",
      "client_1",
      "-w",
      "50%",
      "-h",
      "50%",
      "-E",
      "env WOSM_TUI_POPUP=1 WOSM_FOCUS_PROVIDER=tmux WOSM_FOCUS_CLIENT_ID=client_1 wosm tui --popup",
    ]);
  });

  it("runs tmux display-popup through the external command boundary", async () => {
    const calls: ExternalCommandInput[] = [];
    const expectedPopupArgs = buildTmuxPopupArgs({
      config: {
        popupWidth: "90%",
        popupHeight: "80%",
        popupPosition: "C",
      },
      focusClientId: "client_1",
      popupState: {
        clientId: "client_1",
        optionName: "@wosm_popup_client",
        tmuxCommand: "tmux",
      },
    });

    await expect(
      openTmuxPopup({
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "display-message") {
            return result(input, "client_1\n");
          }
          return result(input);
        },
        env: {
          TMUX: "/tmp/tmux-501/default,123,0",
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
        args: ["display-message", "-p", "#{client_name}"],
      }),
      expect.objectContaining({
        command: "tmux",
        args: ["show-options", "-sqv", "@wosm_popup_client"],
      }),
      expect.objectContaining({
        command: "tmux",
        args: ["set-option", "-sq", "@wosm_popup_client", "client_1"],
      }),
      expect.objectContaining({
        command: "tmux",
        args: expectedPopupArgs,
      }),
    ]);
  });

  it("does not time out while the interactive popup is still open", async () => {
    await expect(
      openTmuxPopup({
        timeoutMs: 1,
        env: {},
        runner: async (input) => {
          if (input.args?.[0] === "display-popup") {
            await sleep(10);
          }
          return result(input);
        },
      }),
    ).resolves.toEqual({ opened: true });
  });

  it("reports popup failures with the provider-specific message", async () => {
    await expect(
      openTmuxPopup({
        env: {},
        runner: async (input) => {
          if (input.args?.[0] === "display-popup") {
            throw Object.assign(new Error("tmux failed"), {
              code: 1,
              stderr: "display-popup failed",
            });
          }
          return result(input);
        },
      }),
    ).rejects.toMatchObject({
      code: "TERMINAL_OPEN_FAILED",
      message: "tmux failed to open the wosm popup.",
      provider: "tmux",
    });
  });

  it("uses the focus client id from the environment for tmux key bindings", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      openTmuxPopup({
        enterWorkbench: true,
        env: {
          WOSM_FOCUS_CLIENT_ID: "client_from_binding",
        },
        runner: async (input) => {
          calls.push(input);
          return result(input);
        },
      }),
    ).resolves.toEqual({ opened: true });

    expect(calls.map((call) => call.args)).toEqual([
      ["show-options", "-sqv", "@wosm_popup_client"],
      ["set-option", "-sq", "@wosm_popup_client", "client_from_binding"],
      ["has-session", "-t", "wosm"],
      ["set-option", "-t", "wosm", "mouse", "on"],
      ["set-option", "-t", "wosm", "history-limit", "100000"],
      ["set-option", "-t", "wosm", "set-clipboard", "on"],
      [
        "list-panes",
        "-s",
        "-t",
        "wosm",
        "-F",
        "#{window_id}\t#{pane_id}\t#{pane_dead}\t#{@wosm.role}",
      ],
      ["list-windows", "-t", "wosm", "-F", "#{window_id}"],
      ["switch-client", "-c", "client_from_binding", "-t", "wosm"],
      expect.arrayContaining(["display-popup", "-c", "client_from_binding"]),
    ]);
    expect(calls.some((call) => call.args?.[0] === "display-message")).toBe(false);
  });

  it("enters the workbench and selects the first live agent pane before opening", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      openTmuxPopup({
        enterWorkbench: true,
        env: {
          TMUX: "/tmp/tmux-501/default,123,0",
        },
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "display-message") {
            return result(input, "client_1\n");
          }
          if (input.args?.[0] === "list-panes") {
            return result(input, "@9\t%9\t0\tmain-agent\n@10\t%10\t0\tmain-agent\n");
          }
          return result(input);
        },
      }),
    ).resolves.toEqual({ opened: true });

    expect(calls.map((call) => call.args)).toEqual([
      ["display-message", "-p", "#{client_name}"],
      ["show-options", "-sqv", "@wosm_popup_client"],
      ["set-option", "-sq", "@wosm_popup_client", "client_1"],
      ["has-session", "-t", "wosm"],
      ["set-option", "-t", "wosm", "mouse", "on"],
      ["set-option", "-t", "wosm", "history-limit", "100000"],
      ["set-option", "-t", "wosm", "set-clipboard", "on"],
      [
        "list-panes",
        "-s",
        "-t",
        "wosm",
        "-F",
        "#{window_id}\t#{pane_id}\t#{pane_dead}\t#{@wosm.role}",
      ],
      ["switch-client", "-c", "client_1", "-t", "wosm"],
      ["select-window", "-t", "wosm:@9"],
      ["select-pane", "-t", "%9"],
      expect.arrayContaining(["display-popup", "-c", "client_1"]),
    ]);
  });

  it("creates an empty workbench when no workbench session exists", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      openTmuxPopup({
        enterWorkbench: true,
        env: {
          TMUX: "/tmp/tmux-501/default,123,0",
        },
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "display-message") {
            return result(input, "client_1\n");
          }
          if (input.args?.[0] === "has-session") {
            throw Object.assign(new Error("can't find session"), {
              code: 1,
              stderr: "can't find session",
            });
          }
          return result(input);
        },
      }),
    ).resolves.toEqual({ opened: true });

    expect(calls.map((call) => call.args)).toEqual([
      ["display-message", "-p", "#{client_name}"],
      ["show-options", "-sqv", "@wosm_popup_client"],
      ["set-option", "-sq", "@wosm_popup_client", "client_1"],
      ["has-session", "-t", "wosm"],
      ["new-session", "-d", "-s", "wosm", "-n", "wosm"],
      ["set-option", "-t", "wosm", "mouse", "on"],
      ["set-option", "-t", "wosm", "history-limit", "100000"],
      ["set-option", "-t", "wosm", "set-clipboard", "on"],
      ["switch-client", "-c", "client_1", "-t", "wosm"],
      expect.arrayContaining(["display-popup", "-c", "client_1"]),
    ]);
  });

  it("closes an active popup for the current client instead of opening another one", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      openTmuxPopup({
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "display-message") {
            return result(input, "client_1\n");
          }
          if (input.args?.[0] === "show-options") {
            return result(input, "client_1\n");
          }
          return result(input);
        },
        env: {
          TMUX: "/tmp/tmux-501/default,123,0",
        },
      }),
    ).resolves.toEqual({ opened: false, closed: true });

    expect(calls).toEqual([
      expect.objectContaining({
        args: ["display-message", "-p", "#{client_name}"],
      }),
      expect.objectContaining({
        args: ["show-options", "-sqv", "@wosm_popup_client"],
      }),
      expect.objectContaining({
        args: ["display-popup", "-c", "client_1", "-C"],
      }),
      expect.objectContaining({
        args: ["set-option", "-sq", "-u", "@wosm_popup_client"],
      }),
    ]);
    expect(calls.some((call) => call.args?.includes("-E") === true)).toBe(false);
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
