import { describe, expect, it } from "vitest";
import { intentForDashboardKey } from "../../src/keymap.js";
import { createCommandSnapshot } from "../fixtures/snapshots.js";

describe("TUI dashboard keymap", () => {
  it("maps Enter to focus the selected row", () => {
    const snapshot = createCommandSnapshot("idle");
    const intent = intentForDashboardKey("enter", snapshot, {
      searchQuery: "",
      collapsedProjectIds: new Set(),
      selectedWorktreeId: "wt_web_idle",
    });

    expect(intent).toEqual({
      type: "command",
      command: {
        type: "terminal.focus",
        payload: { targetId: "term_wt_web_idle_agent" },
      },
    });
  });

  it("adds focus origin to row focus commands when provided", () => {
    const snapshot = createCommandSnapshot("idle");
    const intent = intentForDashboardKey(
      "1",
      snapshot,
      {
        searchQuery: "",
        collapsedProjectIds: new Set(),
      },
      {
        focusOrigin: {
          provider: "tmux",
          clientId: "client_1",
        },
      },
    );

    expect(intent).toEqual({
      type: "command",
      command: {
        type: "terminal.focus",
        payload: {
          targetId: "term_wt_web_idle_agent",
          origin: {
            provider: "tmux",
            clientId: "client_1",
          },
        },
      },
    });
  });
});
