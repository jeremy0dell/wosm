import { describe, expect, it } from "vitest";
import {
  buildCreateSessionCommand,
  buildFocusCommand,
  buildPrimaryCommandForRow,
  buildSendPromptCommand,
  buildStartAgentCommand,
  canSendPromptToRow,
} from "../../src/actions.js";
import {
  createCommandSnapshot,
  createDashboardSnapshot,
  createPromptCapableSnapshot,
} from "../fixtures/snapshots.js";

describe("TUI command actions", () => {
  it("maps focusable rows to terminal.focus using the primary agent target", () => {
    const snapshot = createCommandSnapshot("idle");
    const row = snapshot.rows[0];

    expect(row).toBeDefined();
    expect(buildFocusCommand(row)).toEqual({
      type: "terminal.focus",
      payload: { targetId: "term_wt_web_idle_agent" },
    });
  });

  it("maps no-agent rows to session.startAgent with project defaults", () => {
    const snapshot = createCommandSnapshot("none");
    const row = snapshot.rows[0];
    const project = snapshot.projects[0];

    expect(buildStartAgentCommand(row, project)).toEqual({
      type: "session.startAgent",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_no_agent",
        harness: { provider: "codex" },
        terminal: { provider: "tmux", layout: "agent-build-shell", focus: true },
      },
    });
  });

  it("builds session.create from a prompt without leaking provider-specific details", () => {
    const snapshot = createDashboardSnapshot();
    const project = snapshot.projects[0];

    expect(
      buildCreateSessionCommand({
        project,
        branch: "feature/new-dashboard",
        initialPrompt: "wire the dashboard",
      }),
    ).toEqual({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "feature/new-dashboard",
        harness: { provider: "codex", mode: "interactive" },
        terminal: { provider: "tmux", layout: "agent-build-shell", focus: true },
        initialPrompt: "wire the dashboard",
      },
    });
  });

  it("keeps idle-agent primary actions focus-only unless prompt delivery is supported", () => {
    const snapshot = createCommandSnapshot("idle");
    const row = snapshot.rows[0];

    expect(buildPrimaryCommandForRow(row, snapshot)).toEqual({
      type: "terminal.focus",
      payload: { targetId: "term_wt_web_idle_agent" },
    });
    expect(canSendPromptToRow(row, snapshot.sessions)).toBe(false);

    const promptCapable = createPromptCapableSnapshot();
    const promptCapableRow = promptCapable.rows[0];
    expect(canSendPromptToRow(promptCapableRow, promptCapable.sessions)).toBe(true);
    expect(buildSendPromptCommand(promptCapableRow, promptCapable.sessions, "continue")).toEqual({
      type: "session.sendPrompt",
      payload: {
        sessionId: "ses_wt_web_idle",
        prompt: "continue",
        delivery: "harness-native",
      },
    });
  });
});
