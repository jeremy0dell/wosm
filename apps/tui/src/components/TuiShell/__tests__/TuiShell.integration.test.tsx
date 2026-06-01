import { Box, renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { createZeroWorktreeSnapshot } from "../../../../test/fixtures/snapshots.js";
import { Dashboard } from "../../Dashboard/Dashboard.js";
import { helpPanelLayout } from "../../HelpOverlay/HelpOverlay.js";
import { OverlayHost } from "../../OverlayHost/OverlayHost.js";
import { TuiShell } from "../TuiShell.js";

describe("TuiShell", () => {
  it("keeps fixed dashboard rows in place with or without an overlay", () => {
    const columns = 80;
    const rows = 24;
    const withoutOverlay = renderShell(columns, rows, undefined);
    const withOverlay = renderShell(columns, rows, "help");
    const baseLines = withoutOverlay.split("\n");
    const overlayLines = withOverlay.split("\n");

    expect(overlayLines).toHaveLength(rows);
    expect(baseLines).toHaveLength(rows);
    expect(overlayLines[0]).toBe(baseLines[0]);
    expect(overlayLines[1]).toBe(baseLines[1]);
    expect(overlayLines[2]).toBe(baseLines[2]);
    expect(overlayLines.at(-3)).toBe(baseLines.at(-3));
    expect(overlayLines.at(-2)).toBe(baseLines.at(-2));
    expect(overlayLines.at(-1)).toBe(baseLines.at(-1));
    expect(overlayLines.at(-1)).toContain("H:help");
  });

  it("only replaces dashboard cells inside the overlay panel bounds", () => {
    const columns = 80;
    const rows = 24;
    const withoutOverlay = renderShell(columns, rows, undefined).split("\n");
    const withOverlay = renderShell(columns, rows, "help").split("\n");
    const layout = helpPanelLayout(columns, rows);

    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      if (rowIndex >= layout.top && rowIndex < layout.top + layout.height) {
        continue;
      }
      expect(withOverlay[rowIndex]).toBe(withoutOverlay[rowIndex]);
    }
  });

  it.each([
    ["narrow", 36, 12],
    ["normal", 80, 24],
  ])("keeps the help panel inside the %s terminal without moving the footer", (_label, columns, rows) => {
    const frame = renderShell(columns, rows, "help");
    const lines = frame.split("\n");
    const layout = helpPanelLayout(columns, rows);

    expect(lines).toHaveLength(rows);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.left + layout.width).toBeLessThanOrEqual(columns);
    expect(layout.top + layout.height).toBeLessThanOrEqual(rows);
    expect(lines.at(-1)).toContain("H:help");
  });
});

function renderShell(columns: number, rows: number, activeOverlay: "help" | undefined): string {
  const snapshot = createZeroWorktreeSnapshot();
  const screen =
    activeOverlay === undefined ? ({ name: "dashboard" } as const) : ({ name: "help" } as const);
  return stripAnsi(
    renderToString(
      <Box flexDirection="column" height={rows} width={columns}>
        <TuiShell>
          <Dashboard
            columns={columns}
            snapshot={snapshot}
            viewState={{
              searchQuery: "",
              collapsedProjectIds: new Set(),
              scrollOffset: 0,
              terminalRows: rows,
              localRows: { pendingCreate: [], failedCreate: [] },
            }}
          />
          <OverlayHost columns={columns} rows={rows} screen={screen} snapshot={snapshot} />
        </TuiShell>
      </Box>,
      { columns },
    ),
  );
}

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
