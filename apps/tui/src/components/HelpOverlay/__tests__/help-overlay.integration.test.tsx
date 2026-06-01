import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { createDashboardSnapshot } from "../../../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../../../test/support/fakeObserverService.js";
import { App } from "../../../App/App.js";

describe("TUI help overlay", () => {
  it("opens help from uppercase H", async () => {
    const snapshot = createDashboardSnapshot();
    const instance = render(
      <App initialSnapshot={snapshot} service={new FakeTuiObserverService(snapshot)} />,
    );

    instance.stdin.write("H");

    await waitFor(() => instance.lastFrame()?.includes("wosm help") === true);
    instance.unmount();
  });

  it("opens help from ?", async () => {
    const snapshot = createDashboardSnapshot();
    const instance = render(
      <App initialSnapshot={snapshot} service={new FakeTuiObserverService(snapshot)} />,
    );

    instance.stdin.write("?");

    await waitFor(() => instance.lastFrame()?.includes("wosm help") === true);
    instance.unmount();
  });

  it("does not open help from lowercase h", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("h");

    await settle();
    expect(instance.lastFrame()).not.toContain("wosm help");
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it.each([
    ["H", "H"],
    ["?", "?"],
    ["Q", "Q"],
    ["Esc", "\u001B"],
  ])("closes help from %s", async (_label, key) => {
    const snapshot = createDashboardSnapshot();
    const instance = render(
      <App initialSnapshot={snapshot} service={new FakeTuiObserverService(snapshot)} />,
    );

    instance.stdin.write("H");
    await waitFor(() => instance.lastFrame()?.includes("wosm help") === true);

    instance.stdin.write(key);

    await waitFor(() => instance.lastFrame()?.includes("wosm help") !== true);
    instance.unmount();
  });

  it("ignores dashboard commands while help is open", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("H");
    await waitFor(() => instance.lastFrame()?.includes("wosm help") === true);

    instance.stdin.write("5");
    instance.stdin.write("N");
    instance.stdin.write("X");
    instance.stdin.write("/");
    instance.stdin.write("R");

    await settle();
    expect(instance.lastFrame()).toContain("wosm help");
    expect(instance.lastFrame()).not.toContain("new branch:");
    expect(instance.lastFrame()).not.toContain("search:");
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it("keeps persistent popup close keys from dismissing while help is open", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    let dismissCount = 0;
    const instance = render(
      <App
        initialSnapshot={snapshot}
        onDismiss={async () => {
          dismissCount += 1;
        }}
        persistentPopup={true}
        service={service}
      />,
    );

    instance.stdin.write("H");
    await waitFor(() => instance.lastFrame()?.includes("wosm help") === true);

    instance.stdin.write("q");
    await settle();
    expect(dismissCount).toBe(0);
    expect(instance.lastFrame()).toContain("wosm help");

    instance.stdin.write("\u001B");
    await waitFor(() => instance.lastFrame()?.includes("wosm help") !== true);
    expect(dismissCount).toBe(0);
    instance.unmount();
  });

  it("keeps H and ? as prompt input while a prompt mode is active", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("/");
    await waitFor(() => instance.lastFrame()?.includes("search:") === true);

    instance.stdin.write("H");
    instance.stdin.write("?");
    instance.stdin.write("\r");

    await waitFor(() => instance.lastFrame()?.includes("search:") !== true);
    expect(instance.lastFrame()).not.toContain("wosm help");
    expect(service.dispatched).toHaveLength(0);
    instance.unmount();
  });

  it("reveals live dashboard updates after help closes", async () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    await waitFor(() => service.subscribeCount === 1);
    instance.stdin.write("H");
    await waitFor(() => instance.lastFrame()?.includes("wosm help") === true);

    service.emit({
      type: "worktree.updated",
      worktreeId: "wt_web_idle",
      patch: {
        branch: "fix-nav-current",
      },
    });

    instance.stdin.write("Q");

    await waitFor(() => instance.lastFrame()?.includes("fix-nav-current") === true);
    expect(instance.lastFrame()).not.toContain("wosm help");
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
