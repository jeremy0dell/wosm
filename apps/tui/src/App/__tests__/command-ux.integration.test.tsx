import type { SessionView, WorktreeRow, WosmSnapshot } from "@wosm/contracts";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import {
  createCommandSnapshot,
  createDashboardSnapshot,
  fixtureNow,
} from "../../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../../test/support/fakeObserverService.js";
import { App } from "../../App/App.js";
import { createFakeDashboardSnapshot } from "../../dev/fakeDashboard.js";
import type { TuiCommandCompletion } from "../../services/types.js";

describe("TUI command UX", () => {
  it("dispatches terminal.focus from numeric slot mappings", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("5");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "terminal.focus",
      payload: { targetId: "term_wt_web_idle_agent" },
    });
    expect(instance.lastFrame()).toContain("1-9/a-z:open");
    instance.unmount();
  });

  it("retargets visible slots after dashboard scrolling", async () => {
    const snapshot = createFakeDashboardSnapshot({ projectCount: 1, worktreesPerProject: 30 });
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("\u001B[B");
    instance.stdin.write("\u001B[B");
    instance.stdin.write("\u001B[B");
    await settle();
    instance.stdin.write("1");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "terminal.focus",
      payload: { targetId: "term_wt_fake_1_18_agent" },
    });
    instance.unmount();
  });

  it("does not leak mouse wheel sequences into text prompts", async () => {
    const snapshot = createFakeDashboardSnapshot({ projectCount: 1, worktreesPerProject: 30 });
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("/");
    await waitFor(() => instance.lastFrame()?.includes("search:") === true);
    instance.stdin.write("nav");
    instance.stdin.write("\u001B[<65;12;4M");
    await settle();

    expect(instance.lastFrame()).toContain("search: nav");
    expect(instance.lastFrame()).not.toContain("[<65;12;4M");
    instance.unmount();
  });

  it("shows an optimistic start row and dispatches session.startAgent without a queued toast", async () => {
    const snapshot = createCommandSnapshot("none");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("1");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "session.startAgent",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_no_agent",
        terminal: {
          provider: "tmux",
          layout: "agent-build-shell",
          focus: false,
        },
      },
    });
    await waitFor(() => instance.lastFrame()?.includes("starting...") === true);
    expect(instance.lastFrame()).toContain(" [1]");
    expect(instance.lastFrame()).toContain("feature-start");
    expect(instance.lastFrame()).not.toContain("session.startAgent queued");
    instance.unmount();
  });

  it("does not dispatch duplicate start-agent commands while the slot is pending", async () => {
    const snapshot = createCommandSnapshot("none");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("1");
    await waitFor(() => instance.lastFrame()?.includes("starting...") === true);
    instance.stdin.write("1");
    await settle();

    expect(service.dispatched).toHaveLength(1);
    expect(instance.lastFrame()).toContain(" [1]");
    expect(instance.lastFrame()).toContain("starting...");
    instance.unmount();
  });

  it("clears pending start state and focuses the started session after observer truth catches up", async () => {
    const snapshot = createCommandSnapshot("none");
    const service = new DelayedCompletionService(snapshot, 50);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("1");
    await waitFor(() => instance.lastFrame()?.includes("starting...") === true);
    service.setSnapshot(startedAgentSnapshot(snapshot));

    await waitFor(() => service.dispatched.length === 2);
    expect(service.dispatched[0]).toMatchObject({ type: "session.startAgent" });
    expect(service.dispatched[1]).toEqual({
      type: "terminal.focus",
      payload: { targetId: "term_wt_web_no_agent_agent" },
    });
    await waitFor(() => instance.lastFrame()?.includes(" [1] ○ feature-start") === true);
    expect(instance.lastFrame()).not.toContain("starting...");
    instance.unmount();
  });

  it("deduplicates start-agent failure toasts from command completion and events", async () => {
    const snapshot = createCommandSnapshot("none");
    const error = {
      tag: "CommandExecutionError" as const,
      code: "SESSION_START_AGENT_FAILED",
      message: "Session start failed.",
    };
    const service = new DelayedCompletionService(snapshot, 50);
    service.nextCompletion = {
      status: "failed",
      commandId: "cmd_tui_1",
      error,
    };
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("1");
    await waitFor(() => service.waitedForCommandIds.includes("cmd_tui_1"));
    service.emit({ type: "command.failed", commandId: "cmd_tui_1", error });

    await waitFor(() => instance.lastFrame()?.includes(error.message) === true);
    await settle(80);
    expect(instance.lastFrame()).not.toContain("starting...");
    expect(countOccurrences(instance.lastFrame() ?? "", error.message)).toBe(1);
    instance.unmount();
  });

  it("does not dispatch start-agent from an invisible selected row", async () => {
    const snapshot = createCommandSnapshot("none");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("s");

    await settle();
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it("does not dispatch focus from an invisible selected row", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("s");

    await settle();
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it("dispatches session.create from the new-session bottom sheet", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("Create Session") === true);
    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]?.type).toBe("session.create");
    expect(service.dispatched[0]).toMatchObject({
      type: "session.create",
      payload: {
        projectId: "web",
        terminal: {
          provider: "tmux",
          layout: "agent-build-shell",
          focus: false,
        },
      },
    });
    expect(
      service.dispatched[0]?.type === "session.create" ? service.dispatched[0].payload.branch : "",
    ).toMatch(/^web-[0-9a-z]{6}$/);
    instance.unmount();
  });

  it("dispatches session.create with Cursor when selected from the agent picker", async () => {
    const snapshot = createCursorHarnessSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("Create Session") === true);
    instance.stdin.write("A");
    await waitFor(() => instance.lastFrame()?.includes("Choose Agent") === true);
    instance.stdin.write("2");
    await waitFor(() => instance.lastFrame()?.includes("Agent     cursor healthy") === true);
    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toMatchObject({
      type: "session.create",
      payload: {
        harness: {
          provider: "cursor",
          mode: "interactive",
        },
      },
    });
    instance.unmount();
  });

  it("dispatches popup session.create with focus origin without dismissing the popup", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    let dismissed = false;
    const instance = render(
      <App
        initialSnapshot={snapshot}
        onDismiss={async () => {
          dismissed = true;
        }}
        persistentPopup={true}
        resolveFocusOrigin={async () => ({ provider: "tmux", clientId: "client_1" })}
        service={service}
      />,
    );

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("Create Session") === true);
    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toMatchObject({
      type: "session.create",
      payload: {
        terminal: {
          focus: true,
          origin: { provider: "tmux", clientId: "client_1" },
        },
      },
    });
    expect(dismissed).toBe(false);
    instance.unmount();
  });

  it("keeps fullscreen session.create background-first", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("Create Session") === true);
    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toMatchObject({
      type: "session.create",
      payload: {
        terminal: {
          focus: false,
        },
      },
    });
    instance.unmount();
  });

  it("shows local create rows without queued toasts", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new DelayedCompletionService(snapshot, 100);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("Create Session") === true);
    instance.stdin.write("\r");

    await waitFor(() => instance.lastFrame()?.includes("starting session...") === true);
    expect(instance.lastFrame()).toContain("[ ]");
    expect(instance.lastFrame()).not.toContain("session.create accepted");
    expect(instance.lastFrame()).not.toContain("session.create queued");
    instance.unmount();
  });

  it("clears a successful local create row when the observer row branch differs", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new DeferredCompletionService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("Create Session") === true);
    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    await waitFor(() => instance.lastFrame()?.includes("starting session...") === true);
    const command = service.dispatched[0];
    if (command?.type !== "session.create") {
      throw new Error("Expected a session.create command.");
    }
    const originalTitle = command.payload.branch;
    const sourceRow = snapshot.rows.find((candidate) => candidate.id === "wt_web_idle");
    const sourceSession = snapshot.sessions.find((candidate) => candidate.id === "ses_wt_web_idle");
    if (
      sourceRow === undefined ||
      sourceRow.agent === undefined ||
      sourceRow.terminal === undefined
    ) {
      throw new Error("Missing source row fixture.");
    }
    if (sourceSession === undefined) {
      throw new Error("Missing source session fixture.");
    }
    const observerRow = {
      ...sourceRow,
      id: "wt_web_agent_created",
      branch: "agent-created-branch",
      path: "/tmp/wosm/web/worktrees/agent-created-branch",
      agent: {
        ...sourceRow.agent,
        runId: "run_agent_created",
        sessionId: "ses_agent_created",
      },
      terminal: {
        ...sourceRow.terminal,
        workspaceTargetId: "term_agent_created_window",
        primaryAgentTargetId: "term_agent_created_agent",
      },
    };
    service.setSnapshot({
      ...snapshot,
      rows: [observerRow],
      sessions: [
        {
          ...sourceSession,
          id: "ses_agent_created",
          worktreeId: observerRow.id,
          title: originalTitle,
          harness: {
            ...sourceSession.harness,
            runId: "run_agent_created",
          },
          terminal: {
            ...sourceSession.terminal,
            workspaceTargetId: "term_agent_created_window",
            primaryAgentTargetId: "term_agent_created_agent",
          },
        },
      ],
    });
    await waitFor(() => service.subscribeCount >= 1);
    service.emit({ type: "observer.reconciled", at: snapshot.generatedAt, changed: 1 });
    await waitFor(() => service.loadCount >= 1);

    service.resolveCompletion({ status: "succeeded", commandId: "cmd_tui_1" });

    await waitFor(() => instance.lastFrame()?.includes("starting session...") === false);
    expect(instance.lastFrame()).toContain(originalTitle);
    expect(countOccurrences(instance.lastFrame() ?? "", originalTitle)).toBe(1);
    instance.unmount();
  });

  it("shows diagnostic IDs from rejected command receipts", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    service.nextReceipt = {
      commandId: "cmd_rejected_1",
      accepted: false,
      status: "rejected",
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TARGET_STALE",
        message: "The terminal target is stale.",
        diagnosticId: "diag_terminal_stale",
      },
    };
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("5");

    await waitFor(() => instance.lastFrame()?.includes("diagnostic diag_terminal_stale") === true);
    expect(instance.lastFrame()).toContain("The terminal target is stale.");
    instance.unmount();
  });

  it("refreshes the snapshot directly when Z is pressed", async () => {
    const staleSnapshot = createCommandSnapshot("none");
    const refreshedSnapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(staleSnapshot);
    const instance = render(<App initialSnapshot={staleSnapshot} service={service} />);

    expect(instance.lastFrame()).toContain("feature-start");
    service.setSnapshot(refreshedSnapshot);
    instance.stdin.write("Z");

    await waitFor(
      () =>
        service.reconcileReasons.includes("tui-refresh") &&
        instance.lastFrame()?.includes("fix-nav-mobile") === true,
    );
    expect(instance.lastFrame()).toContain(" [1] ○ fix-nav-mobile");
    instance.unmount();
  });

  it("renames a session from a visible slot with optimistic title and success toast", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("R");
    await waitFor(
      () => instance.lastFrame()?.includes("Choose the slot to rename: 1-9/a-z") === true,
    );
    instance.stdin.write("5");
    await waitFor(() => instance.lastFrame()?.includes("Rename Session") === true);
    expect(instance.lastFrame()).toContain("Name      fix-nav-mobile|");

    instance.stdin.write(" updated");
    await waitFor(
      () => instance.lastFrame()?.includes("Name      fix-nav-mobile updated|") === true,
    );
    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "session.rename",
      payload: {
        sessionId: "ses_wt_web_idle",
        title: "fix-nav-mobile updated",
      },
    });
    await waitFor(
      () =>
        instance.lastFrame()?.includes(" [5] ○ fix-nav-mobile updated") === true &&
        instance.lastFrame()?.includes("Session renamed.") === true,
    );
    expect(instance.lastFrame()).not.toContain("session.rename queued");
    instance.unmount();
  });

  it("reverts the optimistic rename title when command completion fails", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    service.nextCompletion = {
      status: "failed",
      commandId: "cmd_tui_1",
      error: {
        tag: "CommandExecutionError",
        code: "SESSION_RENAME_FAILED",
        message: "Session rename failed.",
      },
    };
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("R");
    await waitFor(
      () => instance.lastFrame()?.includes("Choose the slot to rename: 1-9/a-z") === true,
    );
    instance.stdin.write("5");
    await waitFor(() => instance.lastFrame()?.includes("Rename Session") === true);
    instance.stdin.write(" updated");
    instance.stdin.write("\r");

    await waitFor(() => instance.lastFrame()?.includes("Session rename failed.") === true);
    expect(instance.lastFrame()).toContain(" [5] ○ fix-nav-mobile");
    expect(instance.lastFrame()).not.toContain("fix-nav-mobile updated");
    expect(countOccurrences(instance.lastFrame() ?? "", "Session rename failed.")).toBe(1);
    instance.unmount();
  });

  it("deduplicates command.failed rename errors and clears confirmed pending titles", async () => {
    const snapshot = createDashboardSnapshot();
    const error = {
      tag: "CommandExecutionError" as const,
      code: "SESSION_RENAME_FAILED",
      message: "Session rename failed.",
    };
    const service = new DelayedCompletionService(snapshot, 50);
    service.nextCompletion = {
      status: "failed",
      commandId: "cmd_tui_1",
      error,
    };
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("R");
    await waitFor(
      () => instance.lastFrame()?.includes("Choose the slot to rename: 1-9/a-z") === true,
    );
    instance.stdin.write("5");
    await waitFor(() => instance.lastFrame()?.includes("Rename Session") === true);
    instance.stdin.write(" failed");
    instance.stdin.write("\r");
    await waitFor(() => service.waitedForCommandIds.includes("cmd_tui_1"));
    service.emit({ type: "command.failed", commandId: "cmd_tui_1", error });

    await waitFor(() => instance.lastFrame()?.includes(error.message) === true);
    await settle(80);
    expect(instance.lastFrame()).toContain(" [5] ○ fix-nav-mobile");
    expect(instance.lastFrame()).not.toContain("fix-nav-mobile failed");
    expect(countOccurrences(instance.lastFrame() ?? "", error.message)).toBe(1);

    service.nextCompletion = {
      status: "succeeded",
      commandId: "cmd_tui_1",
    };
    instance.stdin.write("R");
    await waitFor(
      () => instance.lastFrame()?.includes("Choose the slot to rename: 1-9/a-z") === true,
    );
    instance.stdin.write("5");
    await waitFor(() => instance.lastFrame()?.includes("Rename Session") === true);
    instance.stdin.write(" confirmed");
    instance.stdin.write("\r");
    await waitFor(() => instance.lastFrame()?.includes("fix-nav-mobile confirmed") === true);
    service.emit({
      type: "session.updated",
      sessionId: "ses_wt_web_idle",
      patch: { title: "fix-nav-mobile confirmed" },
    });
    await settle();
    service.emit({
      type: "session.updated",
      sessionId: "ses_wt_web_idle",
      patch: { title: "Observer final title" },
    });

    await waitFor(() => instance.lastFrame()?.includes("Observer final title") === true);
    expect(instance.lastFrame()).not.toContain("fix-nav-mobile confirmed");
    instance.unmount();
  }, 15_000);

  it("deduplicates command.failed rename errors after command wait errors", async () => {
    const snapshot = createDashboardSnapshot();
    const waitError = {
      tag: "CommandExecutionError" as const,
      code: "SESSION_RENAME_WAIT_FAILED",
      message: "Session rename wait failed.",
    };
    const commandFailedError = {
      tag: "CommandExecutionError" as const,
      code: "SESSION_RENAME_FAILED",
      message: "Session rename command failed.",
    };
    const service = new FailingCompletionService(snapshot, waitError);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("R");
    await waitFor(
      () => instance.lastFrame()?.includes("Choose the slot to rename: 1-9/a-z") === true,
    );
    instance.stdin.write("5");
    await waitFor(() => instance.lastFrame()?.includes("Rename Session") === true);
    instance.stdin.write(" failed");
    instance.stdin.write("\r");

    await waitFor(() => instance.lastFrame()?.includes(waitError.message) === true);
    service.emit({ type: "command.failed", commandId: "cmd_tui_1", error: commandFailedError });
    await settle();

    expect(instance.lastFrame()).toContain(" [5] ○ fix-nav-mobile");
    expect(instance.lastFrame()).not.toContain("fix-nav-mobile failed");
    expect(instance.lastFrame()).not.toContain(commandFailedError.message);
    expect(countOccurrences(instance.lastFrame() ?? "", waitError.message)).toBe(1);
    instance.unmount();
  });

  it("reconnects the event stream and reloads a snapshot when the stream ends", async () => {
    const staleSnapshot = createCommandSnapshot("none");
    const refreshedSnapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(staleSnapshot);
    const instance = render(<App initialSnapshot={staleSnapshot} service={service} />);

    await waitFor(() => service.subscribeCount === 1);
    service.setSnapshot(refreshedSnapshot);
    service.endSubscriptions();

    await waitFor(
      () =>
        service.subscribeCount >= 2 &&
        service.loadCount >= 1 &&
        instance.lastFrame()?.includes("fix-nav-mobile") === true,
      1000,
    );
    instance.unmount();
  });

  it("blocks the new-session prompt when the worktree provider is unavailable", async () => {
    const snapshot = createDashboardSnapshot();
    const unavailable = {
      providerId: "worktrunk",
      providerType: "worktree" as const,
      status: "unavailable" as const,
      lastCheckedAt: snapshot.generatedAt,
      lastError: {
        tag: "ProviderUnavailableError",
        code: "WORKTRUNK_UNAVAILABLE",
        message: "Worktrunk is not available.",
        hint: "Install Worktrunk with brew install worktrunk.",
        provider: "worktrunk",
      },
    };
    const blockedSnapshot = {
      ...snapshot,
      providerHealth: {
        ...snapshot.providerHealth,
        worktrunk: unavailable,
      },
      projects: snapshot.projects.map((project, index) =>
        index === 0 ? { ...project, health: unavailable } : project,
      ),
    };
    const service = new FakeTuiObserverService(blockedSnapshot);
    const instance = render(<App initialSnapshot={blockedSnapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("Create Session") === true);
    instance.stdin.write("\r");

    await waitFor(() => instance.lastFrame()?.includes("Worktrunk is not available.") === true);
    expect(instance.lastFrame()).not.toContain("Create Session");
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it("removes a picked slot after y confirmation", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("X");
    await waitFor(() => instance.lastFrame()?.includes("remove slot:") === true);

    instance.stdin.write("5");
    await waitFor(
      () => instance.lastFrame()?.includes("confirm remove fix-nav-mobile? Y/N") === true,
    );

    instance.stdin.write("y");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "worktree.remove",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_idle",
        force: true,
      },
    });
    await waitFor(() => instance.lastFrame()?.includes("removing worktree...") === true);
    expect(instance.lastFrame()).toContain("fix-nav-mobile");
    expect(instance.lastFrame()).toMatch(/\[ \] . fix-nav-mobile {2}removing worktree\.\.\./);

    service.emit({ type: "worktree.removed", worktreeId: "wt_web_idle" });
    await waitFor(() => instance.lastFrame()?.includes("fix-nav-mobile") === false);
    instance.unmount();
  });

  it("clears the removing row marker and keeps the safe error toast when removal fails", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    service.nextCompletion = {
      status: "failed",
      commandId: "cmd_tui_1",
      error: {
        tag: "CommandExecutionError",
        code: "WORKTREE_REMOVE_FAILED",
        message: "Worktree remove failed.",
      },
    };
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("X");
    await waitFor(() => instance.lastFrame()?.includes("remove slot:") === true);
    instance.stdin.write("5");
    await waitFor(
      () => instance.lastFrame()?.includes("confirm remove fix-nav-mobile? Y/N") === true,
    );
    instance.stdin.write("y");

    await waitFor(() => instance.lastFrame()?.includes("Worktree remove failed.") === true);
    expect(instance.lastFrame()).toContain("fix-nav-mobile");
    expect(instance.lastFrame()).not.toContain("removing worktree...");
    instance.unmount();
  });

  it("deduplicates remove failure toasts from command completion and events", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const error = {
      tag: "CommandExecutionError" as const,
      code: "WORKTREE_REMOVE_FAILED",
      message: "Worktree remove failed.",
    };
    service.nextCompletion = {
      status: "failed",
      commandId: "cmd_tui_1",
      error,
    };
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("X");
    await waitFor(() => instance.lastFrame()?.includes("remove slot:") === true);
    instance.stdin.write("5");
    await waitFor(
      () => instance.lastFrame()?.includes("confirm remove fix-nav-mobile? Y/N") === true,
    );
    instance.stdin.write("y");

    await waitFor(() => instance.lastFrame()?.includes(error.message) === true);
    const initialCount = countOccurrences(instance.lastFrame() ?? "", error.message);
    service.emit({ type: "command.failed", commandId: "cmd_tui_1", error });
    await settle();

    expect(initialCount).toBe(1);
    expect(countOccurrences(instance.lastFrame() ?? "", error.message)).toBe(1);
    instance.unmount();
  });

  it("cancels picked-slot removal by default", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("X");
    await waitFor(() => instance.lastFrame()?.includes("remove slot:") === true);
    instance.stdin.write("5");
    await waitFor(
      () => instance.lastFrame()?.includes("confirm remove fix-nav-mobile? Y/N") === true,
    );

    instance.stdin.write("\r");

    await waitFor(
      () => instance.lastFrame()?.includes("confirm remove fix-nav-mobile? Y/N") !== true,
    );
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it("does not open cleanup confirmation from invisible selected-row commands", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("t");
    instance.stdin.write("c");
    instance.stdin.write("x");

    await settle();
    expect(instance.lastFrame()).not.toContain("confirm close terminal");
    expect(instance.lastFrame()).not.toContain("confirm close all");
    expect(instance.lastFrame()).not.toContain("confirm remove worktree");
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it("collapses and expands project rows through the project-select prompt", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("C");
    await waitFor(() => instance.lastFrame()?.includes("collapse project: 1:web 2:api") === true);

    instance.stdin.write("1");
    await waitFor(() => instance.lastFrame()?.includes("▶ web - 7 worktrees") === true);
    expect(instance.lastFrame()).not.toContain("fix-nav-mobile");
    expect(instance.lastFrame()).not.toContain("collapse project:");
    expect(instance.lastFrame()).toMatch(/ \[1\] . queue-worker/);

    instance.stdin.write("5");
    await settle();
    expect(service.dispatched).toHaveLength(0);

    instance.stdin.write("C");
    await waitFor(() => instance.lastFrame()?.includes("collapse project: 1:web 2:api") === true);
    instance.stdin.write("1");
    await waitFor(() => instance.lastFrame()?.includes("▼ web - 7 worktrees") === true);
    expect(instance.lastFrame()).toContain(" [5] ○ fix-nav-mobile");

    instance.stdin.write("C");
    await waitFor(() => instance.lastFrame()?.includes("collapse project: 1:web 2:api") === true);
    instance.stdin.write("\u001B");
    await waitFor(() => instance.lastFrame()?.includes("collapse project:") !== true);
    expect(instance.lastFrame()).toContain("▼ web - 7 worktrees");
    expect(instance.lastFrame()).not.toContain("| codex");
    expect(instance.lastFrame()).toContain(" [5] ○ fix-nav-mobile");

    instance.stdin.write("C");
    await waitFor(() => instance.lastFrame()?.includes("collapse project: 1:web 2:api") === true);
    instance.stdin.write("1");
    await waitFor(() => instance.lastFrame()?.includes("▶ web - 7 worktrees") === true);
    instance.stdin.write("X");
    await waitFor(() => instance.lastFrame()?.includes("remove slot:") === true);
    instance.stdin.write("5");
    await settle();
    expect(instance.lastFrame()).not.toContain("confirm remove fix-nav-mobile? Y/N");
    expect(service.dispatched).toHaveLength(0);

    instance.unmount();
  });

  it("does not trigger dashboard commands from lowercase aliases", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("n");
    instance.stdin.write("r");
    instance.stdin.write("z");
    instance.stdin.write("x");

    await settle();
    expect(instance.lastFrame()).not.toContain("Create Session");
    expect(instance.lastFrame()).not.toContain("remove slot:");
    expect(service.reconcileReasons).not.toContain("tui-refresh");
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });
});

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

function createCursorHarnessSnapshot(): WosmSnapshot {
  const snapshot = createDashboardSnapshot();
  return {
    ...snapshot,
    harnesses: [
      { id: "codex", label: "codex" },
      { id: "cursor", label: "cursor" },
    ],
    providerHealth: {
      ...snapshot.providerHealth,
      codex: {
        providerId: "codex",
        providerType: "harness",
        status: "healthy",
        lastCheckedAt: snapshot.generatedAt,
      },
      cursor: {
        providerId: "cursor",
        providerType: "harness",
        status: "healthy",
        lastCheckedAt: snapshot.generatedAt,
      },
    },
  };
}

function startedAgentSnapshot(snapshot: WosmSnapshot): WosmSnapshot {
  const sourceRow = snapshot.rows.find((row) => row.id === "wt_web_no_agent");
  if (sourceRow === undefined) {
    throw new Error("Expected no-agent row in fixture snapshot.");
  }
  const startedRow: WorktreeRow = {
    ...sourceRow,
    terminal: {
      provider: "tmux",
      state: "open",
      workspaceTargetId: "term_wt_web_no_agent_window",
      primaryAgentTargetId: "term_wt_web_no_agent_agent",
      attached: true,
      lastOutputAt: fixtureNow,
    },
    agent: {
      harness: "codex",
      state: "idle",
      runId: "run_wt_web_no_agent",
      sessionId: "ses_wt_web_no_agent",
      confidence: "high",
      reason: "Harness reported the turn completed.",
      updatedAt: fixtureNow,
    },
    display: {
      statusLabel: "idle",
      sortPriority: 40,
      alert: false,
    },
  };
  const session: SessionView = {
    id: "ses_wt_web_no_agent",
    projectId: "web",
    worktreeId: "wt_web_no_agent",
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
    harness: {
      provider: "codex",
      mode: "interactive",
      runId: "run_wt_web_no_agent",
      capabilities: {
        canLaunch: true,
        canDiscoverRuns: true,
        canEmitEvents: true,
        canClassifyStatus: true,
        canReceivePrompt: false,
        canResume: true,
        canStop: true,
        canRunNonInteractive: true,
        canExposeApprovalState: true,
      },
    },
    terminal: {
      provider: "tmux",
      exists: true,
      workspaceTargetId: "term_wt_web_no_agent_window",
      primaryAgentTargetId: "term_wt_web_no_agent_agent",
      attached: true,
      lastOutputAt: fixtureNow,
    },
    status: {
      value: "idle",
      confidence: "high",
      reason: "Harness reported the turn completed.",
      source: "harness_event",
      updatedAt: fixtureNow,
    },
    title: sourceRow.branch,
    tags: ["codex", "tmux"],
  };

  return {
    ...snapshot,
    rows: snapshot.rows.map((row) => (row.id === sourceRow.id ? startedRow : row)),
    sessions: [...snapshot.sessions.filter((candidate) => candidate.id !== session.id), session],
    counts: {
      ...snapshot.counts,
      agents: snapshot.counts.agents + 1,
      idle: snapshot.counts.idle + 1,
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}

class DelayedCompletionService extends FakeTuiObserverService {
  constructor(
    snapshot: ReturnType<typeof createDashboardSnapshot>,
    private readonly delayMs: number,
  ) {
    super(snapshot);
  }

  override async waitForCommandCompletion(commandId: string) {
    this.waitedForCommandIds.push(commandId);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.nextCompletion;
  }
}

class FailingCompletionService extends FakeTuiObserverService {
  constructor(
    snapshot: ReturnType<typeof createDashboardSnapshot>,
    private readonly error: unknown,
  ) {
    super(snapshot);
  }

  override async waitForCommandCompletion(commandId: string) {
    this.waitedForCommandIds.push(commandId);
    throw this.error;
  }
}

class DeferredCompletionService extends FakeTuiObserverService {
  private resolveWaiter: ((completion: TuiCommandCompletion) => void) | undefined;

  override async waitForCommandCompletion(commandId: string) {
    this.waitedForCommandIds.push(commandId);
    return new Promise<TuiCommandCompletion>((resolve) => {
      this.resolveWaiter = resolve;
    });
  }

  resolveCompletion(completion: TuiCommandCompletion): void {
    const resolve = this.resolveWaiter;
    if (resolve === undefined) {
      throw new Error("No command completion waiter is registered.");
    }
    this.resolveWaiter = undefined;
    resolve(completion);
  }
}

async function settle(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
