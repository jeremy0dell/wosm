import { Box, renderToString } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { App } from "../../src/App.js";
import { Dashboard } from "../../src/components/Dashboard.js";
import { TuiModeProvider } from "../../src/tuiMode.js";
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
    expect(frame).toContain("[1] ! checkout-copy");
    expect(frame).toContain("[2] ! slow-tests");
    expect(frame).toContain("[3] * cache-refactor");
    expect(frame).toContain("[4] . fix-nav-mobile");
    expect(frame).toContain("[5] ? ghost-signal");
    expect(frame).toContain("[6] x done-run");
    expect(frame).toContain("[7] - feature-auth");
    expect(frame).not.toContain(">");
    expect(frame).not.toContain("s:start bg");
    expect(frame).not.toContain("enter/1-9");
    expect(frame).not.toContain("providerData");
    expect(frame).not.toContain("inspect");
    expect(frame).not.toContain("debug panel");
    instance.unmount();
  });

  it("anchors the keybinding footer to the bottom row of the dashboard frame", () => {
    const snapshot = createZeroWorktreeSnapshot();
    const frame = renderToString(
      <Box flexDirection="column" height={12} width={100}>
        <Dashboard
          snapshot={snapshot}
          uiState={{ searchQuery: "", collapsedProjectIds: new Set() }}
        />
      </Box>,
      { columns: 100 },
    );
    const lines = frame.split("\n");

    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toContain("n:new bg 1-9:start/focus x:remove /:search r:refresh q:quit");
    expect(lines.slice(0, -1).join("\n")).not.toContain("n:new bg");
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

  it("labels q and escape as close in persistent popup mode", () => {
    const snapshot = createDashboardSnapshot();
    const instance = render(
      <App
        initialSnapshot={snapshot}
        onDismiss={async () => undefined}
        persistentPopup={true}
        service={new FakeTuiObserverService(snapshot)}
      />,
    );
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("q/esc:close");
    expect(frame).not.toContain("q:quit");
    instance.unmount();
  });

  it("marks the dashboard header in dev mode", () => {
    const snapshot = createDashboardSnapshot();
    const instance = render(
      <TuiModeProvider mode="dev">
        <App initialSnapshot={snapshot} service={new FakeTuiObserverService(snapshot)} />
      </TuiModeProvider>,
    );
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("wosm dev 2 projects");
    instance.unmount();
  });
});
