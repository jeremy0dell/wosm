import { Box, renderToString } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import {
  createDashboardSnapshot,
  createZeroWorktreeSnapshot,
} from "../../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../../test/support/fakeObserverService.js";
import { Dashboard } from "../../components/Dashboard/Dashboard.js";
import { TuiModeProvider } from "../../tuiMode.js";
import { App } from "../App.js";

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
    expect(frame).toContain(" [1] ◜ cache-refactor");
    expect(frame).toContain(" [2] ! checkout-copy");
    expect(frame).toContain(" [3] x done-run");
    expect(frame).toContain(" [4] - feature-auth");
    expect(frame).toContain(" [5] ○ fix-nav-mobile");
    expect(frame).toContain(" [6] ? ghost-signal");
    expect(frame).toContain(" [7] ! slow-tests");
    expect(frame).not.toContain("needs attention");
    expect(frame).not.toContain("stuck");
    expect(frame).not.toContain("working");
    expect(frame).not.toContain("idle");
    expect(frame).not.toContain("unknown");
    expect(frame).not.toContain("exited");
    expect(frame).not.toContain("no agent");
    expect(frame).not.toContain(">");
    expect(frame).not.toContain("s:start bg");
    expect(frame).not.toContain("enter/1-9");
    expect(frame).not.toContain("providerData");
    expect(frame).not.toContain("tmux");
    expect(frame).not.toContain("inspect");
    expect(frame).not.toContain("debug panel");
    instance.unmount();
  });

  it("anchors the keybinding footer to the bottom row of the dashboard frame", () => {
    const snapshot = createZeroWorktreeSnapshot();
    const frame = renderToString(
      <Box flexDirection="column" height={12} width={100}>
        <Dashboard
          columns={100}
          snapshot={snapshot}
          viewState={{
            searchQuery: "",
            collapsedProjectIds: new Set(),
            scrollOffset: 0,
            terminalRows: 12,
          }}
        />
      </Box>,
      { columns: 100 },
    );
    const lines = frame.split("\n");
    const body = lines.slice(3, -3).join("\n");

    expect(lines).toHaveLength(12);
    expect(lines[0]).toBe("wosm");
    expect(lines[1]).toMatch(/^─+$/);
    expect(lines[2]?.trim()).toBe("");
    expect(lines[3]).toContain("web");
    expect(body).toContain("web");
    expect(body).toContain("api");
    expect(lines.at(-3)?.trim()).toBe("");
    expect(lines.at(-2)).toMatch(/^─+$/);
    expect(lines.at(-1)).toContain(
      "N:new 1-9/a-z:start/focus X:remove /:search R:refresh H:help Q:quit",
    );
    expect(lines.slice(0, -1).join("\n")).not.toContain("N:new 1-9/a-z");
  });

  it("renders the dashboard layout scaffold with dev label, dividers, and close hint", () => {
    const snapshot = createZeroWorktreeSnapshot();
    const frame = renderToString(
      <TuiModeProvider mode="dev">
        <Box flexDirection="column" height={10} width={72}>
          <Dashboard
            columns={72}
            snapshot={snapshot}
            viewState={{
              searchQuery: "",
              collapsedProjectIds: new Set(),
              scrollOffset: 0,
              terminalRows: 10,
            }}
            quitActionLabel="close"
          />
        </Box>
      </TuiModeProvider>,
      { columns: 72 },
    );
    const lines = frame.split("\n");

    expect(lines[0]).toBe("wosm dev");
    expect(lines[1]).toMatch(/^─+$/);
    expect(lines.at(-2)).toMatch(/^─+$/);
    expect(lines.at(-1)).toContain("N:new");
    expect(lines.at(-1)).toContain("H:help");
    expect(lines.at(-1)).toContain("Q/esc:close");
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

  it("labels Q and escape as close in persistent popup mode", () => {
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

    expect(frame).toContain("Q/esc:close");
    expect(frame).not.toContain("Q:quit");
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

    expect(frame).toContain("wosm dev");
    expect(frame).not.toContain("wosm dev 2 projects");
    instance.unmount();
  });
});
