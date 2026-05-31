import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import {
  createCommandSnapshot,
  createDashboardSnapshot,
} from "../../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../../test/support/fakeObserverService.js";
import { App } from "../../App/App.js";
import { createFakeDashboardSnapshot } from "../../dev/fakeDashboard.js";

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
    expect(instance.lastFrame()).toContain("1-9/a-z:start/focus");
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
      payload: { targetId: "term_wt_fake_1_10_agent" },
    });
    instance.unmount();
  });

  it("dispatches session.startAgent from numeric slot mappings for no-agent rows", async () => {
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
    await waitFor(() => instance.lastFrame()?.includes("New Session") === true);
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

  it("labels accepted command receipts as queued work", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("New Session") === true);
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

    instance.stdin.write("5");

    await waitFor(() => instance.lastFrame()?.includes("diagnostic diag_terminal_stale") === true);
    expect(instance.lastFrame()).toContain("The terminal target is stale.");
    instance.unmount();
  });

  it("refreshes the snapshot directly when R is pressed", async () => {
    const staleSnapshot = createCommandSnapshot("none");
    const refreshedSnapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(staleSnapshot);
    const instance = render(<App initialSnapshot={staleSnapshot} service={service} />);

    expect(instance.lastFrame()).toContain("feature-start");
    service.setSnapshot(refreshedSnapshot);
    instance.stdin.write("R");

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

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("New Session") === true);
    instance.stdin.write("\r");

    await waitFor(() => instance.lastFrame()?.includes("Worktrunk is not available.") === true);
    expect(instance.lastFrame()).not.toContain("New Session");
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

    instance.stdin.write("Y");

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
    await waitFor(() => instance.lastFrame()?.includes("▶ web - 7 worktrees | codex") === true);
    expect(instance.lastFrame()).not.toContain("fix-nav-mobile");
    expect(instance.lastFrame()).not.toContain("collapse project:");
    expect(instance.lastFrame()).toContain(" [1] ◜ queue-worker");

    instance.stdin.write("5");
    await settle();
    expect(service.dispatched).toHaveLength(0);

    instance.stdin.write("C");
    await waitFor(() => instance.lastFrame()?.includes("collapse project: 1:web 2:api") === true);
    instance.stdin.write("1");
    await waitFor(() => instance.lastFrame()?.includes("▼ web - 7 worktrees | codex") === true);
    expect(instance.lastFrame()).toContain(" [5] ○ fix-nav-mobile");

    instance.stdin.write("C");
    await waitFor(() => instance.lastFrame()?.includes("collapse project: 1:web 2:api") === true);
    instance.stdin.write("\u001B");
    await waitFor(() => instance.lastFrame()?.includes("collapse project:") !== true);
    expect(instance.lastFrame()).toContain("▼ web - 7 worktrees | codex");
    expect(instance.lastFrame()).toContain(" [5] ○ fix-nav-mobile");

    instance.stdin.write("C");
    await waitFor(() => instance.lastFrame()?.includes("collapse project: 1:web 2:api") === true);
    instance.stdin.write("1");
    await waitFor(() => instance.lastFrame()?.includes("▶ web - 7 worktrees | codex") === true);
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
    instance.stdin.write("x");

    await settle();
    expect(instance.lastFrame()).not.toContain("New Session");
    expect(instance.lastFrame()).not.toContain("remove slot:");
    expect(service.reconcileReasons).not.toContain("tui-refresh");
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
