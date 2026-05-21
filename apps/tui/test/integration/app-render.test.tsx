import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { App } from "../../src/App.js";
import { createDashboardSnapshot, createZeroWorktreeSnapshot } from "../fixtures/snapshots.js";
import { FakeTuiObserverService } from "../support/fakeObserverService.js";

describe("TUI app rendering", () => {
  it("renders the project-first dashboard and required row states", () => {
    const snapshot = createDashboardSnapshot();
    const instance = render(
      <App initialSnapshot={snapshot} service={new FakeTuiObserverService(snapshot)} />,
    );
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("wosm");
    expect(frame).toContain("web");
    expect(frame).toContain("api");
    expect(frame).toContain("needs attention");
    expect(frame).toContain("stuck");
    expect(frame).toContain("working");
    expect(frame).toContain("idle");
    expect(frame).toContain("unknown");
    expect(frame).toContain("exited");
    expect(frame).toContain("no agent");
    expect(frame).not.toContain("providerData");
    expect(frame).not.toContain("inspect");
    expect(frame).not.toContain("debug panel");
    instance.unmount();
  });

  it("renders configured projects even when they have zero worktrees", () => {
    const snapshot = createZeroWorktreeSnapshot();
    const instance = render(
      <App initialSnapshot={snapshot} service={new FakeTuiObserverService(snapshot)} />,
    );
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("web");
    expect(frame).toContain("api");
    expect(frame).toContain("0 worktrees");
    instance.unmount();
  });
});
