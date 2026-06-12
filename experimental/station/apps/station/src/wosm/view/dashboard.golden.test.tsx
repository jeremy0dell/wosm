// Golden-frame matrix for the WOSM dashboard render: every scenario fixture
// at every surface size in the acceptance plan, snapshotted as the captured
// character frame (reviewable in __snapshots__), plus span-level color
// probes for the parity-critical presentations (alert-red rows, check
// glyphs, PR underline). Frames are captured immediately after the first
// render, before the 120ms throbber tick, so animated markers show their
// first frame (◜ / ⠋) deterministically.
import { afterEach, describe, expect, it } from "bun:test";
import { rgbToHex, TextAttributes } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import type { WosmClientConnectionState } from "@wosm/client";
import type { WosmSnapshot } from "@wosm/contracts";
import { spanAtFrameCell } from "../../terminal/testing/frameProbe.js";
import {
  attentionAndFailuresSnapshot,
  manyProjectsSnapshot,
  noProjectsSnapshot,
  scenarioState,
} from "../fixtures/scenarios.js";
import { createTuiStore } from "@wosm/dashboard-core";
import { FakeStationSource } from "../test/support/fakeStationSource.js";
import { FakeTuiObserverService } from "../test/support/fakeObserverService.js";
import { DashboardRoot } from "./DashboardRoot.js";
import { WOSM_COLORS } from "./theme.js";

function spanHex(span: ReturnType<typeof spanAtFrameCell>): string | undefined {
  return span?.fg === undefined ? undefined : rgbToHex(span.fg);
}

const SIZES = [
  { width: 80, height: 24 },
  { width: 120, height: 40 },
  { width: 60, height: 16 },
  { width: 40, height: 12 },
] as const;

const SNAPSHOT_SCENARIOS: ReadonlyArray<{ name: string; snapshot: () => WosmSnapshot }> = [
  { name: "many-projects", snapshot: manyProjectsSnapshot },
  { name: "attention-and-failures", snapshot: attentionAndFailuresSnapshot },
  { name: "no-projects", snapshot: noProjectsSnapshot },
];

type RenderedDashboard = Awaited<ReturnType<typeof testRender>>;

describe("dashboard golden frames", () => {
  const teardowns: Array<() => void> = [];
  afterEach(() => {
    for (const teardown of teardowns.splice(0)) {
      teardown();
    }
  });

  async function renderDashboard(input: {
    width: number;
    height: number;
    snapshot?: WosmSnapshot;
    connection?: WosmClientConnectionState;
  }): Promise<RenderedDashboard> {
    const source = new FakeStationSource(input.snapshot, input.connection);
    const store = createTuiStore({
      source,
      service: new FakeTuiObserverService(input.snapshot ?? manyProjectsSnapshot()),
      persistentPopup: true,
      onDismiss: async () => {},
    });
    store.getState().start();
    const setup = await testRender(
      <DashboardRoot store={store} columns={input.width} rows={input.height} />,
      { width: input.width, height: input.height },
    );
    teardowns.push(() => {
      setup.renderer.destroy();
    });
    await setup.renderOnce();
    return setup;
  }

  for (const scenario of SNAPSHOT_SCENARIOS) {
    for (const size of SIZES) {
      it(`renders ${scenario.name} at ${size.width}x${size.height}`, async () => {
        const setup = await renderDashboard({ ...size, snapshot: scenario.snapshot() });
        expect(setup.captureCharFrame()).toMatchSnapshot();
      });
    }
  }

  it("renders the loading state", async () => {
    const setup = await renderDashboard({
      width: 80,
      height: 24,
      connection: { state: "loading", since: Date.now() },
    });
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Loading observer snapshot...");
    expect(frame).toContain("Q/esc:close");
  });

  it("renders the waiting-for-observer state on cold reconnects", async () => {
    const setup = await renderDashboard({
      width: 80,
      height: 24,
      connection: {
        state: "reconnecting",
        since: Date.now(),
        lastError: {
          tag: "ProtocolError",
          code: "PROTOCOL_CONNECT_FAILED",
          message: "Could not connect to observer socket.",
        },
      },
    });
    const frame = setup.captureCharFrame();
    expect(frame).toContain("waiting for observer");
    expect(frame).toContain("retrying connection");
    expect(frame).toContain("The dashboard will appear when the observer is ready.");
  });

  it("shows the display-only reconnect status in the header", async () => {
    const disconnected = scenarioState("disconnected");
    const setup = await renderDashboard({
      width: 80,
      height: 24,
      snapshot: disconnected.snapshot,
      connection: disconnected.connection,
    });
    const frame = setup.captureCharFrame();
    expect(frame).toContain("observer reconnecting · display-only snapshot");
  });

  it("renders the parity-critical status presentation", async () => {
    const setup = await renderDashboard({
      width: 80,
      height: 24,
      snapshot: attentionAndFailuresSnapshot(),
    });
    const frame = setup.captureCharFrame();
    // Status glyphs and labels from the parity checklist.
    expect(frame).toContain("! hook-scope");
    // The constraint solver truncates meaningful activity text at 80 cols.
    expect(frame).toContain("Agent needs app…");
    expect(frame).toContain("◜ pr-info");
    expect(frame).toContain("? metadata-refresh");
    expect(frame).toContain("x done-run");
    expect(frame).toContain("x2");
    expect(frame).toContain("✓");
    expect(frame).toContain("…");
    // Project headers with the disclosure marker and harness suffix.
    expect(frame).toContain("▼ wosm - 4 worktrees | codex");
    expect(frame).toContain("▼ observer - 2 worktrees | opencode");
  });

  it("colors alert rows red and check glyphs by state", async () => {
    const setup = await renderDashboard({
      width: 80,
      height: 24,
      snapshot: attentionAndFailuresSnapshot(),
    });
    const charFrame = setup.captureCharFrame();
    const frame = setup.captureSpans();
    const lines = charFrame.split("\n");

    const attentionRow = lines.findIndex((line) => line.includes("! hook-scope"));
    expect(attentionRow).toBeGreaterThan(0);
    const markerCol = lines[attentionRow]?.indexOf("!") ?? -1;
    expect(spanHex(spanAtFrameCell(frame, attentionRow, markerCol))).toBe(WOSM_COLORS.red);

    const failGlyphCol = lines[attentionRow]?.lastIndexOf("x2") ?? -1;
    expect(failGlyphCol).toBeGreaterThan(0);
    expect(spanHex(spanAtFrameCell(frame, attentionRow, failGlyphCol))).toBe(WOSM_COLORS.red);

    const prCol = lines[attentionRow]?.indexOf("#12") ?? -1;
    expect(prCol).toBeGreaterThan(0);
    const prSpan = spanAtFrameCell(frame, attentionRow, prCol);
    expect(spanHex(prSpan)).toBe(WOSM_COLORS.blue);
    expect(((prSpan?.attributes ?? 0) & TextAttributes.UNDERLINE) !== 0).toBe(true);
  });

  it("assigns slots only to visible actionable rows", async () => {
    const setup = await renderDashboard({ width: 80, height: 24, snapshot: manyProjectsSnapshot() });
    const frame = setup.captureCharFrame();
    expect(frame).toContain("[1]");
    // The starting row gets a slot too (it has a focusable terminal), but the
    // empty project renders its zero-count line with no slot cell.
    expect(frame).toContain("0 worktrees");
  });
});
