import { describe, expect, it } from "vitest";
import { createCommandSnapshot } from "../test/fixtures/snapshots.js";
import { intentForDashboardKey } from "./keymap.js";

describe("TUI dashboard keymap", () => {
  it("does not target an invisible selected row for Enter", () => {
    const snapshot = createCommandSnapshot("idle");
    const intent = intentForDashboardKey("enter", snapshot, {
      searchQuery: "",
      collapsedProjectIds: new Set(),
    });

    expect(intent).toEqual({ type: "none" });
  });

  it("does not target an invisible selected row for row-scoped commands", () => {
    const snapshot = createCommandSnapshot("idle");
    const state = {
      searchQuery: "",
      collapsedProjectIds: new Set<string>(),
    };

    expect(intentForDashboardKey("s", snapshot, state)).toEqual({ type: "none" });
    expect(intentForDashboardKey("a", snapshot, state)).toEqual({ type: "none" });
    expect(intentForDashboardKey("t", snapshot, state)).toEqual({ type: "none" });
    expect(intentForDashboardKey("c", snapshot, state)).toEqual({ type: "none" });
    expect(intentForDashboardKey("x", snapshot, state)).toEqual({ type: "none" });
  });

  it("opens the new-session flow from lower- or uppercase n", () => {
    const snapshot = createCommandSnapshot("idle");
    const state = {
      searchQuery: "",
      collapsedProjectIds: new Set<string>(),
    };

    expect(intentForDashboardKey("n", snapshot, state)).toEqual({
      type: "open-new-session-prompt",
    });
    expect(intentForDashboardKey("N", snapshot, state)).toEqual({
      type: "open-new-session-prompt",
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
