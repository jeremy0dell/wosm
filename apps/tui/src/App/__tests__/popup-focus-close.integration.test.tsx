import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import {
  createCommandSnapshot,
  createDashboardSnapshot,
} from "../../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../../test/support/fakeObserverService.js";
import { App } from "../App.js";

describe("TUI transient focus-and-close navigation", () => {
  it("dispatches terminal.focus with focus origin and exits after focus succeeds", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const exits: number[] = [];
    const instance = render(
      <App
        focusOrigin={{ provider: "tmux", clientId: "client_1" }}
        initialSnapshot={snapshot}
        onExit={(code) => exits.push(code)}
        exitOnFocusSuccess={true}
        service={service}
      />,
    );

    instance.stdin.write("5");

    await waitFor(() => exits.length === 1);
    expect(service.dispatched[0]).toEqual({
      type: "terminal.focus",
      payload: {
        targetId: "term_wt_web_idle_agent",
        origin: {
          provider: "tmux",
          clientId: "client_1",
        },
      },
    });
    expect(service.waitedForCommandIds).toEqual(["cmd_tui_1"]);
    expect(exits).toEqual([0]);
    instance.unmount();
  });

  it("resolves persistent popup focus origin at activation time and dismisses without exiting", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const exits: number[] = [];
    let resolveCount = 0;
    let dismissCount = 0;
    const instance = render(
      <App
        resolveFocusOrigin={async () => {
          resolveCount += 1;
          return { provider: "tmux", clientId: `client_${resolveCount}` };
        }}
        onFocusSuccess={async () => {
          dismissCount += 1;
        }}
        initialSnapshot={snapshot}
        onExit={(code) => exits.push(code)}
        persistentPopup={true}
        service={service}
      />,
    );

    instance.stdin.write("5");

    await waitFor(() => dismissCount === 1);
    expect(service.dispatched[0]).toEqual({
      type: "terminal.focus",
      payload: {
        targetId: "term_wt_web_idle_agent",
        origin: {
          provider: "tmux",
          clientId: "client_1",
        },
      },
    });
    expect(service.waitedForCommandIds).toEqual(["cmd_tui_1"]);
    expect(exits).toEqual([]);
    instance.unmount();
  });

  it("starts no-agent rows through the focus-and-close lifecycle", async () => {
    const snapshot = createCommandSnapshot("none");
    const service = new DelayedCompletionService(snapshot, 50);
    const exits: number[] = [];
    const instance = render(
      <App
        focusOrigin={{ provider: "tmux", clientId: "client_1" }}
        initialSnapshot={snapshot}
        onExit={(code) => exits.push(code)}
        exitOnFocusSuccess={true}
        service={service}
      />,
    );

    instance.stdin.write("1");
    await waitFor(() => service.waitedForCommandIds.includes("cmd_tui_1"));
    service.emit({
      type: "worktree.agentStateChanged",
      worktreeId: "wt_web_no_agent",
      agent: {
        harness: "codex",
        state: "idle",
        runId: "run_wt_web_no_agent",
        sessionId: "ses_wt_web_no_agent",
        confidence: "high",
        reason: "Harness reported the turn completed.",
        updatedAt: snapshot.generatedAt,
      },
    });

    await waitFor(() => exits.length === 1);
    expect(service.dispatched[0]).toMatchObject({
      type: "session.startAgent",
      payload: {
        terminal: {
          focus: true,
          origin: { provider: "tmux", clientId: "client_1" },
        },
      },
    });
    expect(service.dispatched[1]).toEqual({
      type: "terminal.focus",
      payload: {
        sessionId: "ses_wt_web_no_agent",
        origin: { provider: "tmux", clientId: "client_1" },
      },
    });
    expect(exits).toEqual([0]);
    instance.unmount();
  });

  it("dismisses a persistent popup on Q without exiting the TUI process", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const exits: number[] = [];
    let dismissCount = 0;
    const instance = render(
      <App
        initialSnapshot={snapshot}
        onDismiss={async () => {
          dismissCount += 1;
        }}
        onExit={(code) => exits.push(code)}
        persistentPopup={true}
        service={service}
      />,
    );

    instance.stdin.write("Q");

    await waitFor(() => dismissCount === 1);
    expect(exits).toEqual([]);
    expect(service.cleanupCount).toBe(0);
    instance.unmount();
  });

  it("dismisses a persistent popup on escape without exiting the TUI process", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const exits: number[] = [];
    let dismissCount = 0;
    const instance = render(
      <App
        initialSnapshot={snapshot}
        onDismiss={async () => {
          dismissCount += 1;
        }}
        onExit={(code) => exits.push(code)}
        persistentPopup={true}
        service={service}
      />,
    );

    instance.stdin.write("\u001B");

    await waitFor(() => dismissCount === 1);
    expect(exits).toEqual([]);
    expect(service.cleanupCount).toBe(0);
    instance.unmount();
  });

  it("falls back to normal Q exit when a persistent popup has no dismiss hook", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const exits: number[] = [];
    const instance = render(
      <App
        initialSnapshot={snapshot}
        onExit={(code) => exits.push(code)}
        persistentPopup={true}
        service={service}
      />,
    );

    instance.stdin.write("Q");

    await waitFor(() => exits.length === 1);
    expect(exits).toEqual([0]);
    instance.unmount();
  });

  it("stays open and shows a SafeError toast when focus fails", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    service.nextCompletion = {
      status: "failed",
      commandId: "cmd_tui_1",
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TARGET_STALE",
        message: "The terminal target is stale.",
        diagnosticId: "diag_terminal_stale",
      },
    };
    const exits: number[] = [];
    const instance = render(
      <App
        initialSnapshot={snapshot}
        onExit={(code) => exits.push(code)}
        exitOnFocusSuccess={true}
        service={service}
      />,
    );

    instance.stdin.write("5");

    await waitFor(() => instance.lastFrame()?.includes("The terminal target is stale.") === true);
    expect(instance.lastFrame()).toContain("diagnostic diag_terminal_stale");
    expect(exits).toEqual([]);
    instance.unmount();
  });

  it("keeps a persistent popup visible and does not dismiss when focus fails", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    service.nextCompletion = {
      status: "failed",
      commandId: "cmd_tui_1",
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TARGET_STALE",
        message: "The terminal target is stale.",
        diagnosticId: "diag_terminal_stale",
      },
    };
    const exits: number[] = [];
    let dismissCount = 0;
    const instance = render(
      <App
        resolveFocusOrigin={async () => ({ provider: "tmux", clientId: "client_1" })}
        onFocusSuccess={async () => {
          dismissCount += 1;
        }}
        initialSnapshot={snapshot}
        onExit={(code) => exits.push(code)}
        persistentPopup={true}
        service={service}
      />,
    );

    instance.stdin.write("5");

    await waitFor(() => instance.lastFrame()?.includes("The terminal target is stale.") === true);
    expect(instance.lastFrame()).toContain("diagnostic diag_terminal_stale");
    expect(dismissCount).toBe(0);
    expect(exits).toEqual([]);
    instance.unmount();
  });

  it("does not exit after a successful focus unless exit-on-focus is enabled", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const exits: number[] = [];
    const instance = render(
      <App initialSnapshot={snapshot} onExit={(code) => exits.push(code)} service={service} />,
    );

    instance.stdin.write("5");

    await waitFor(() => service.dispatched.length === 1);
    expect(exits).toEqual([]);
    expect(service.waitedForCommandIds).toEqual([]);
    instance.unmount();
  });

  it("does not activate focus-and-close from Enter without a selected row", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const exits: number[] = [];
    const instance = render(
      <App
        initialSnapshot={snapshot}
        onExit={(code) => exits.push(code)}
        exitOnFocusSuccess={true}
        service={service}
      />,
    );

    instance.stdin.write("\r");

    await settle();
    expect(service.dispatched).toHaveLength(0);
    expect(exits).toEqual([]);
    instance.unmount();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
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
