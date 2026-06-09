import { Box, renderToString } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import {
  createDashboardSnapshot,
  createNoProjectsSnapshot,
  createZeroWorktreeSnapshot,
} from "../../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../../test/support/fakeObserverService.js";
import { Dashboard } from "../../components/Dashboard/Dashboard.js";
import type { TuiObserverService } from "../../services/types.js";
import { TuiModeProvider } from "../../tuiMode.js";
import type { WeatherClient } from "../../widgets/types.js";
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
    expect(frame).toContain("working");
    expect(frame).toContain("idle");
    expect(frame).toContain("unknown");
    expect(frame).toContain("exited");
    expect(frame).toContain("no agent");
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
            localRows: { pendingCreate: [], failedCreate: [], pendingRemove: [], pendingStart: [] },
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
      "N:new A:add R:rename Z:refresh 1-9/a-z:open X:rm /:search C:fold H:help Q:quit",
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
              localRows: {
                pendingCreate: [],
                failedCreate: [],
                pendingRemove: [],
                pendingStart: [],
              },
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
    expect(lines.at(-1)).toContain("A:add");
    expect(lines.at(-1)).toContain("H:help");
    expect(lines.at(-1)).toContain("Q/esc:close");
  });

  it("renders first-run empty state with Add Project", () => {
    const snapshot = createNoProjectsSnapshot();
    const instance = render(
      <App initialSnapshot={snapshot} service={new FakeTuiObserverService(snapshot)} />,
    );
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("No projects configured yet.");
    expect(frame).toContain("A:Add Project");
    expect(frame).not.toContain("S:setup");
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

  it("renders configured widgets on the observer snapshot loading screen", () => {
    const instance = render(
      <App
        service={pendingObserverService()}
        tuiConfig={{
          widgets: [
            { type: "time", timeFormat: "12h" },
            {
              type: "weather",
              city: "New York, NY",
              label: "NYC",
            },
          ],
        }}
        topRowWidgetDeps={{
          now: widgetTestNow,
          weatherClient: weatherClientPending(),
        }}
      />,
    );
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("wosm");
    expect(frame).toContain("10:42 AM  NYC --° ⏳");
    expect(frame).toContain("Loading observer snapshot...");
    instance.unmount();
  });

  it("renders configured time and weather widgets while preserving dashboard rows", async () => {
    const snapshot = createDashboardSnapshot();
    const instance = render(
      <App
        initialSnapshot={snapshot}
        service={new FakeTuiObserverService(snapshot)}
        tuiConfig={{
          widgets: [
            { type: "time", timeFormat: "12h" },
            {
              type: "weather",
              city: "New York, NY",
              label: "NYC",
              temperatureUnit: "fahrenheit",
              refreshIntervalMinutes: 15,
            },
          ],
        }}
        topRowWidgetDeps={{
          now: widgetTestNow,
          weatherClient: weatherClientReturning({
            temperature: 72,
            weatherCode: 0,
            isDay: true,
          }),
        }}
      />,
    );

    await waitFor(() => instance.lastFrame()?.includes("10:42 AM  NYC 72° ☀️") === true);
    const frame = instance.lastFrame() ?? "";
    const lines = frame.split("\n");

    expect(lines[0]).toContain("wosm");
    expect(lines[1]).toMatch(/^─+$/);
    expect(frame).toMatch(/ \[1\] . cache-refactor/);
    expect(frame).toContain("N:new");
    expect(frame).not.toContain("providerData");
    instance.unmount();
  });

  it("keeps dashboard rows usable while weather is loading", () => {
    const snapshot = createDashboardSnapshot();
    const instance = render(
      <App
        initialSnapshot={snapshot}
        service={new FakeTuiObserverService(snapshot)}
        tuiConfig={{
          widgets: [
            {
              type: "weather",
              city: "New York, NY",
              label: "NYC",
            },
          ],
        }}
        topRowWidgetDeps={{
          weatherClient: weatherClientPending(),
        }}
      />,
    );
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("NYC --° ⏳");
    expect(frame).toMatch(/ \[1\] . cache-refactor/);
    expect(frame).toContain("N:new");
    instance.unmount();
  });

  it.each([
    ["not found", "ZZZ", new Error("not_found")],
    ["timeout", "NYC", new Error("timeout")],
    ["rejection", "NYC", new Error("network failed")],
  ])("renders compact weather error on %s without surfacing diagnostics", async (_name, city, error) => {
    const snapshot = createDashboardSnapshot();
    const instance = render(
      <App
        initialSnapshot={snapshot}
        service={new FakeTuiObserverService(snapshot)}
        tuiConfig={{
          widgets: [
            {
              type: "weather",
              city,
            },
          ],
        }}
        topRowWidgetDeps={{
          weatherClient: weatherClientRejecting(error),
        }}
      />,
    );

    await waitFor(() => instance.lastFrame()?.includes(`${city} --° 🫥`) === true);
    const frame = instance.lastFrame() ?? "";

    expect(frame).toMatch(/ \[1\] . cache-refactor/);
    expect(frame).not.toContain(error.message);
    expect(frame).not.toContain("diagnostic");
    expect(frame).not.toContain("providerData");
    expect(frame).not.toContain("stack");
    instance.unmount();
  });
});

function widgetTestNow(): Date {
  return new Date(2026, 5, 2, 10, 42);
}

function weatherClientReturning(
  conditions: Awaited<ReturnType<WeatherClient["getCurrentWeather"]>>,
): WeatherClient {
  return {
    getCurrentWeather: async () => conditions,
  };
}

function weatherClientRejecting(error: Error): WeatherClient {
  return {
    getCurrentWeather: async () => {
      throw error;
    },
  };
}

function weatherClientPending(): WeatherClient {
  return {
    getCurrentWeather: () => new Promise(() => undefined),
  };
}

function pendingObserverService(): TuiObserverService {
  return {
    loadSnapshot: () => new Promise(() => undefined),
    subscribeEvents: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => undefined),
        return: async () => ({ done: true, value: undefined }),
      }),
    }),
    dispatch: async () => ({
      commandId: "cmd_tui_1",
      accepted: true,
      status: "accepted",
    }),
    waitForCommandCompletion: async (commandId) => ({
      status: "succeeded",
      commandId,
    }),
    reconcile: () => new Promise(() => undefined),
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (predicate()) {
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
