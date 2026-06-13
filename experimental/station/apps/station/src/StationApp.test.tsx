import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createStationAppComposition } from "./StationApp.js";
import { selectWosmOverlayVisible } from "./state/selectors.js";
import { createStationStore } from "./state/store.js";
import { MAIN_PANE_ID } from "./state/types.js";
import { createScriptedTerminal } from "./terminal/testing/scriptedTerminal.js";
import { waitFor } from "./terminal/testing/waitFor.js";
import { manyProjectsSnapshot, noProjectsSnapshot } from "./wosm/fixtures/scenarios.js";
import { FakeStationSource } from "./wosm/test/support/fakeStationSource.js";
import { createStationStubObserverService } from "./wosm/store/stubObserverService.js";

const SURFACE = { width: 100, height: 28 };
const teardowns: Array<() => void> = [];

describe("Station app composition", () => {
  afterEach(() => {
    for (const teardown of teardowns.splice(0)) {
      teardown();
    }
  });

  it("wires overlay input, source updates, preserved view state, and teardown", async () => {
    const station = await renderComposedStation();

    station.setup.mockInput.pressKey("o", { ctrl: true });
    await waitFor(() => overlayVisible(station));
    expect(await waitForFrame(station, (frame) => frame.includes("wosm - 5 worktrees"))).toContain(
      "wosm - 5 worktrees",
    );

    await station.setup.mockInput.typeText("blocked");
    expect(station.scripted.helpers.writes.join("")).not.toContain("blocked");

    await station.setup.mockInput.typeText("C1");
    await waitFor(() => station.composition.wosmViewStore.getState().collapsedProjectIds.has("wosm"));
    station.setup.mockInput.pressKey("o", { ctrl: true });
    await waitFor(() => !overlayVisible(station));
    station.setup.mockInput.pressKey("o", { ctrl: true });
    await waitFor(() => overlayVisible(station));
    expect(station.composition.wosmViewStore.getState().collapsedProjectIds.has("wosm")).toBe(true);

    station.source.setSnapshot(noProjectsSnapshot());
    expect(await waitForFrame(station, (frame) => frame.includes("No projects configured yet."))).toContain(
      "No projects configured yet.",
    );

    station.setup.mockInput.pressKey("c", { ctrl: true });
    await waitFor(() => !overlayVisible(station));
    station.setup.mockInput.pressKey("o", { ctrl: true });
    await waitFor(() => overlayVisible(station));
    expect(await waitForFrame(station, (frame) => frame.includes("No projects configured yet."))).toContain(
      "No projects configured yet.",
    );

    station.composition.stationInput.dispatchMouse({ kind: "header" }, {});
    await waitFor(() => !overlayVisible(station));
    station.composition.stationInput.dispatchMouse({ kind: "header" }, {});
    await waitFor(() => overlayVisible(station));
    expect(await waitForFrame(station, (frame) => frame.includes("No projects configured yet."))).toContain(
      "No projects configured yet.",
    );

    station.composition.stationInput.dispatchMouse({ kind: "header" }, {});
    await waitFor(() => !overlayVisible(station));
    await station.setup.mockInput.typeText("allowed");
    await waitFor(() => station.scripted.helpers.writes.join("").includes("allowed"));

    station.composition.dispose();
    expect(station.source.unsubscribeCount).toBe(1);
    expect(station.source.stopped).toBe(1);
    expect(station.scripted.helpers.isDisposed()).toBe(true);
  });

  it("reconciles the registry to created and closed pane records", async () => {
    const station = await renderComposedStation();
    expect(station.composition.registry.has(MAIN_PANE_ID)).toBe(true);

    station.store.actions.createPane("pane-second", {
      split: { anchorPaneId: MAIN_PANE_ID, direction: "right" },
    });
    const paneRecord = station.store
      .getState()
      .workspace.panes.find((pane) => pane.id === "pane-second");
    expect(paneRecord).toEqual({
      id: "pane-second",
      split: { anchorPaneId: MAIN_PANE_ID, direction: "right" },
    });
    expect(station.composition.registry.has("pane-second")).toBe(true);

    station.store.actions.closePane("pane-second");
    expect(station.composition.registry.has("pane-second")).toBe(false);
    // The original pane is never torn down by switching to and from it.
    expect(station.composition.registry.has(MAIN_PANE_ID)).toBe(true);
  });
});

async function waitForFrame(
  station: Awaited<ReturnType<typeof renderComposedStation>>,
  predicate: (frame: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + 2_000;
  let frame = "";
  for (;;) {
    await station.setup.renderOnce();
    frame = station.setup.captureCharFrame();
    if (predicate(frame)) {
      return frame;
    }
    if (Date.now() > deadline) {
      throw new Error(`frame predicate timed out; last frame:\n${frame}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function renderComposedStation() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const store = createStationStore();
  const source = new TrackingStationSource(manyProjectsSnapshot());
  const scripted = createScriptedTerminal();
  const shutdowns: number[] = [];
  const composition = createStationAppComposition({
    store,
    wosmClient: {
      state: source,
      service: createStationStubObserverService(source, { dispatchDelayMs: 1 }),
      start: () => {
        source.start();
      },
      stop: () => source.stop(),
    },
    shutdown: () => {
      shutdowns.push(1);
    },
    createTerminal: () => scripted.terminal,
  });

  const setup = await testRender(<composition.App />, {
    ...SURFACE,
    prependInputHandlers: [composition.stationInput.handleSequence],
    kittyKeyboard: false,
  });
  setup.renderer.keyInput.on("paste", (event) => {
    composition.stationInput.handlePaste(event);
  });
  teardowns.push(() => {
    composition.dispose();
    setup.renderer.destroy();
  });

  composition.start();
  await setup.flush();
  await waitFor(() => scripted.helpers.writes !== undefined);

  return { composition, scripted, setup, shutdowns, source, store };
}

function overlayVisible(station: Awaited<ReturnType<typeof renderComposedStation>>): boolean {
  return selectWosmOverlayVisible(station.store.getState());
}

class TrackingStationSource extends FakeStationSource {
  unsubscribeCount = 0;

  override subscribe(listener: () => void): () => void {
    const unsubscribe = super.subscribe(listener);
    return () => {
      this.unsubscribeCount += 1;
      unsubscribe();
    };
  }
}
