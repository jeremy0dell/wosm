import { describe, expect, it } from "vitest";
import {
  buildCleanupCommand,
  buildCreateSessionCommand,
  buildFocusCommand,
  buildPrimaryCommandForRow,
  buildSendPromptCommand,
  buildStartAgentCommand,
  canSendPromptToRow,
  cleanupForceRequired,
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

  it("adds focus origin only when transient navigation provides one", () => {
    const snapshot = createCommandSnapshot("idle");
    const row = snapshot.rows[0];

    expect(
      buildFocusCommand(row, {
        origin: {
          provider: "tmux",
          clientId: "client_1",
        },
      }),
    ).toEqual({
      type: "terminal.focus",
      payload: {
        targetId: "term_wt_web_idle_agent",
        origin: {
          provider: "tmux",
          clientId: "client_1",
        },
      },
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
        terminal: { provider: "tmux", layout: "agent-build-shell", focus: false },
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
        terminal: { provider: "tmux", layout: "agent-build-shell", focus: false },
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

  it("builds cleanup commands and omits force when guards are not required", () => {
    const snapshot = createCommandSnapshot("idle");
    const row = snapshot.rows[0];

    expect(buildCleanupCommand(row, "close-harness", false)).toEqual({
      type: "session.close",
      payload: {
        sessionId: "ses_wt_web_idle",
        mode: "harness",
      },
    });
    expect(buildCleanupCommand(row, "close-terminal", false)).toEqual({
      type: "terminal.close",
      payload: {
        targetId: "term_wt_web_idle_agent",
      },
    });
    expect(buildCleanupCommand(row, "close-all", false)).toEqual({
      type: "session.close",
      payload: {
        sessionId: "ses_wt_web_idle",
        mode: "all",
      },
    });
    expect(buildCleanupCommand(row, "remove-worktree", false)).toEqual({
      type: "worktree.remove",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_idle",
      },
    });
  });

  it("adds force only for guarded cleanup confirmations", () => {
    const snapshot = createCommandSnapshot("idle", { dirty: true });
    const row = snapshot.rows[0];

    expect(cleanupForceRequired(row, "remove-worktree")).toBe(true);
    expect(cleanupForceRequired(row, "close-terminal")).toBe(true);
    expect(buildCleanupCommand(row, "remove-worktree", true)).toEqual({
      type: "worktree.remove",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_idle",
        force: true,
      },
    });
    expect(buildCleanupCommand(row, "close-terminal", true)).toEqual({
      type: "terminal.close",
      payload: {
        targetId: "term_wt_web_idle_agent",
        force: true,
      },
    });
  });
});
