import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { App } from "../../src/App.js";
import { createCommandSnapshot, createDashboardSnapshot } from "../fixtures/snapshots.js";
import { FakeTuiObserverService } from "../support/fakeObserverService.js";

describe("TUI command UX", () => {
  it("dispatches terminal.focus from numeric slot mappings", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("4");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "terminal.focus",
      payload: { targetId: "term_wt_web_idle_agent" },
    });
    instance.unmount();
  });

  it("dispatches session.startAgent for no-agent rows", async () => {
    const snapshot = createCommandSnapshot("none");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("s");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "session.startAgent",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_no_agent",
        harness: { provider: "codex" },
        terminal: { provider: "tmux", layout: "agent-build-shell", focus: false },
      },
    });
    instance.unmount();
  });

  it("keeps idle-agent primary action focus-only", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("s");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "terminal.focus",
      payload: { targetId: "term_wt_web_idle_agent" },
    });
    instance.unmount();
  });

  it("dispatches session.create from the new-session prompt", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("n");
    instance.stdin.write("feature/tui-new");
    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toMatchObject({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "feature/tui-new",
        terminal: {
          provider: "tmux",
          layout: "agent-build-shell",
          focus: false,
        },
      },
    });
    instance.unmount();
  });

  it("labels accepted command receipts as queued work", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("n");
    instance.stdin.write("feature/tui-new");
    instance.stdin.write("\r");

    await waitFor(() => instance.lastFrame()?.includes("session.create queued") === true);
    expect(instance.lastFrame()).not.toContain("session.create accepted");
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

    instance.stdin.write("4");

    await waitFor(() => instance.lastFrame()?.includes("diagnostic diag_terminal_stale") === true);
    expect(instance.lastFrame()).toContain("The terminal target is stale.");
    instance.unmount();
  });

  it("refreshes the snapshot directly when r is pressed", async () => {
    const staleSnapshot = createCommandSnapshot("none");
    const refreshedSnapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(staleSnapshot);
    const instance = render(<App initialSnapshot={staleSnapshot} service={service} />);

    expect(instance.lastFrame()).toContain("feature-start");
    service.setSnapshot(refreshedSnapshot);
    instance.stdin.write("r");

    await waitFor(
      () =>
        service.reconcileReasons.includes("tui-refresh") &&
        instance.lastFrame()?.includes("fix-nav-mobile") === true,
    );
    expect(instance.lastFrame()).toContain("idle");
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

    instance.stdin.write("n");

    await waitFor(() => instance.lastFrame()?.includes("Worktrunk is not available.") === true);
    expect(instance.lastFrame()).not.toContain("new branch:");
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it("asks for cleanup confirmation before dispatching destructive commands", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("t");

    await waitFor(() => instance.lastFrame()?.includes("confirm close terminal") === true);
    expect(service.dispatched).toHaveLength(0);

    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "terminal.close",
      payload: {
        targetId: "term_wt_web_idle_agent",
        force: true,
      },
    });
    instance.unmount();
  });

  it("cancels cleanup confirmation with escape", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("c");
    await waitFor(() => instance.lastFrame()?.includes("confirm close all") === true);
    instance.stdin.write("\u001B");

    await waitFor(() => instance.lastFrame()?.includes("confirm close all") === false);
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it("confirms dirty active worktree removal with force", async () => {
    const snapshot = createCommandSnapshot("idle", { dirty: true });
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("x");
    await waitFor(() => instance.lastFrame()?.includes("confirm remove worktree") === true);
    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "worktree.remove",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_idle",
        force: true,
      },
    });
    instance.unmount();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}
