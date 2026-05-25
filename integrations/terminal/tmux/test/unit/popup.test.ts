import { setTimeout as sleep } from "node:timers/promises";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import {
  buildTmuxPopupArgs,
  dismissTmuxPopup,
  ensurePersistentPopupSession,
  openTmuxPopup,
  resolveTmuxPopupFocusOrigin,
} from "../../src/popup";

const defaultPersistentSignature = "v1:wosm tui --popup --persistent";

describe("tmux popup", () => {
  it("builds a persistent popup command that attaches the hidden UI session", () => {
    expect(buildTmuxPopupArgs()).toEqual([
      "display-popup",
      "-w",
      "50%",
      "-h",
      "50%",
      "-E",
      "env -u TMUX tmux attach-session -t _wosm-ui",
    ]);
  });

  it("keeps transient TUI popup command construction available", () => {
    expect(buildTmuxPopupArgs({ persistent: false, focusClientId: "client_1" })).toEqual([
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

  it("creates the persistent UI session only when it is missing", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      ensurePersistentPopupSession({
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "has-session") {
            throw Object.assign(new Error("can't find session"), {
              code: 1,
              stderr: "can't find session",
            });
          }
          return result(input);
        },
      }),
    ).resolves.toEqual({ sessionName: "_wosm-ui", created: true });

    expect(calls.map((call) => call.args)).toEqual([
      ["has-session", "-t", "_wosm-ui"],
      [
        "new-session",
        "-d",
        "-s",
        "_wosm-ui",
        "-n",
        "wosm-ui",
        "env WOSM_TUI_POPUP=1 WOSM_FOCUS_PROVIDER=tmux wosm tui --popup --persistent",
      ],
      [
        "set-option",
        "-t",
        "_wosm-ui",
        "-q",
        "@wosm_popup_ui_signature",
        defaultPersistentSignature,
      ],
    ]);

    calls.length = 0;
    await expect(
      ensurePersistentPopupSession({
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "show-options") {
            return result(input, `${defaultPersistentSignature}\n`);
          }
          return result(input);
        },
      }),
    ).resolves.toEqual({ sessionName: "_wosm-ui", created: false });
    expect(calls.map((call) => call.args)).toEqual([
      ["has-session", "-t", "_wosm-ui"],
      ["show-options", "-t", "_wosm-ui", "-qv", "@wosm_popup_ui_signature"],
    ]);
  });

  it("recreates the persistent UI session when its command signature changed", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      ensurePersistentPopupSession({
        tuiCommand: "node wosm tui --popup --persistent --config /tmp/config-b.toml",
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "show-options") {
            return result(
              input,
              "v1:node wosm tui --popup --persistent --config /tmp/config-a.toml\n",
            );
          }
          return result(input);
        },
      }),
    ).resolves.toEqual({ sessionName: "_wosm-ui", created: true });

    expect(calls.map((call) => call.args)).toEqual([
      ["has-session", "-t", "_wosm-ui"],
      ["show-options", "-t", "_wosm-ui", "-qv", "@wosm_popup_ui_signature"],
      ["kill-session", "-t", "_wosm-ui"],
      [
        "new-session",
        "-d",
        "-s",
        "_wosm-ui",
        "-n",
        "wosm-ui",
        "env WOSM_TUI_POPUP=1 WOSM_FOCUS_PROVIDER=tmux node wosm tui --popup --persistent --config /tmp/config-b.toml",
      ],
      [
        "set-option",
        "-t",
        "_wosm-ui",
        "-q",
        "@wosm_popup_ui_signature",
        "v1:node wosm tui --popup --persistent --config /tmp/config-b.toml",
      ],
    ]);
  });

  it("opens the popup by attaching the persistent UI session and recording tmux popup state", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      openTmuxPopup({
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "display-message") {
            return result(input, "client_1\n");
          }
          if (
            input.args?.[0] === "show-options" &&
            input.args.includes("@wosm_popup_ui_signature")
          ) {
            return result(input, `${defaultPersistentSignature}\n`);
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
    ).resolves.toEqual({ opened: true });

    expect(calls.map((call) => call.args)).toEqual([
      ["display-message", "-p", "#{client_name}"],
      ["show-options", "-gqv", "@wosm_popup_client"],
      ["set-option", "-gq", "@wosm_popup_client", "client_1"],
      ["set-option", "-gq", "@wosm_popup_focus_client", "client_1"],
      ["has-session", "-t", "_wosm-ui"],
      ["show-options", "-t", "_wosm-ui", "-qv", "@wosm_popup_ui_signature"],
      [
        "display-popup",
        "-c",
        "client_1",
        "-w",
        "90%",
        "-h",
        "80%",
        "-E",
        expect.stringContaining("env -u TMUX tmux attach-session -t _wosm-ui"),
      ],
    ]);
    const displayPopupArgs = calls.at(-1)?.args;
    const popupShellCommand = displayPopupArgs?.[displayPopupArgs.length - 1];
    expect(popupShellCommand).toContain("fi; if");
    expect(popupShellCommand).not.toContain("fi if");
  });

  it("closes an active popup for the current client without killing the UI session", async () => {
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

    expect(calls.map((call) => call.args)).toEqual([
      ["display-message", "-p", "#{client_name}"],
      ["show-options", "-gqv", "@wosm_popup_client"],
      ["display-popup", "-c", "client_1", "-C"],
      ["set-option", "-gq", "-u", "@wosm_popup_client"],
      ["set-option", "-gq", "-u", "@wosm_popup_focus_client"],
    ]);
    expect(calls.some((call) => call.args?.[0] === "kill-session")).toBe(false);
    expect(calls.some((call) => call.args?.[0] === "new-session")).toBe(false);
  });

  it("closes a popup active for another client before opening a new one", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      openTmuxPopup({
        env: {
          WOSM_FOCUS_CLIENT_ID: "client_2",
        },
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "show-options" && input.args.includes("@wosm_popup_client")) {
            return result(input, "client_1\n");
          }
          if (
            input.args?.[0] === "show-options" &&
            input.args.includes("@wosm_popup_ui_signature")
          ) {
            return result(input, `${defaultPersistentSignature}\n`);
          }
          return result(input);
        },
      }),
    ).resolves.toEqual({ opened: true });

    expect(calls.map((call) => call.args)).toEqual([
      ["show-options", "-gqv", "@wosm_popup_client"],
      ["display-popup", "-c", "client_1", "-C"],
      ["set-option", "-gq", "@wosm_popup_client", "client_2"],
      ["set-option", "-gq", "@wosm_popup_focus_client", "client_2"],
      ["has-session", "-t", "_wosm-ui"],
      ["show-options", "-t", "_wosm-ui", "-qv", "@wosm_popup_ui_signature"],
      expect.arrayContaining(["display-popup", "-c", "client_2"]),
    ]);
  });

  it("resolves the focus origin from the current tmux popup client option", async () => {
    await expect(
      resolveTmuxPopupFocusOrigin({
        runner: async (input) => result(input, "client_2\n"),
      }),
    ).resolves.toEqual({
      provider: "tmux",
      clientId: "client_2",
    });
  });

  it("dismisses the popup for the recorded focus client", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      dismissTmuxPopup({
        runner: async (input) => {
          calls.push(input);
          if (input.args?.[0] === "show-options") {
            return result(input, "client_2\n");
          }
          return result(input);
        },
      }),
    ).resolves.toEqual({ dismissed: true });

    expect(calls.map((call) => call.args)).toEqual([
      ["show-options", "-gqv", "@wosm_popup_focus_client"],
      ["display-popup", "-c", "client_2", "-C"],
      ["set-option", "-gq", "-u", "@wosm_popup_client"],
      ["set-option", "-gq", "-u", "@wosm_popup_focus_client"],
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

  it("enters the workbench before opening when requested", async () => {
    const calls: ExternalCommandInput[] = [];

    await expect(
      openTmuxPopup({
        enterWorkbench: true,
        env: {
          WOSM_FOCUS_CLIENT_ID: "client_from_binding",
        },
        runner: async (input) => {
          calls.push(input);
          if (
            input.args?.[0] === "show-options" &&
            input.args.includes("@wosm_popup_ui_signature")
          ) {
            return result(input, `${defaultPersistentSignature}\n`);
          }
          return result(input);
        },
      }),
    ).resolves.toEqual({ opened: true });

    expect(calls.map((call) => call.args)).toEqual([
      ["show-options", "-gqv", "@wosm_popup_client"],
      ["set-option", "-gq", "@wosm_popup_client", "client_from_binding"],
      ["set-option", "-gq", "@wosm_popup_focus_client", "client_from_binding"],
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
      ["has-session", "-t", "_wosm-ui"],
      ["show-options", "-t", "_wosm-ui", "-qv", "@wosm_popup_ui_signature"],
      expect.arrayContaining(["display-popup", "-c", "client_from_binding"]),
    ]);
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
