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
    expect(service.dispatched[0]?.type).toBe("session.startAgent");
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
