import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { App } from "../../src/App.js";
import { createCommandSnapshot, createDashboardSnapshot } from "../fixtures/snapshots.js";
import { FakeTuiObserverService } from "../support/fakeObserverService.js";

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

    instance.stdin.write("4");

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

    instance.stdin.write("4");

    await waitFor(() => instance.lastFrame()?.includes("The terminal target is stale.") === true);
    expect(instance.lastFrame()).toContain("diagnostic diag_terminal_stale");
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

    instance.stdin.write("4");

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

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
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
