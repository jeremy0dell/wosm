import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { OverlayLayer } from "../OverlayLayer.js";

describe("OverlayLayer", () => {
  it("places overlay content absolutely without adding rows or shifting siblings", () => {
    const rows = 12;
    const columns = 60;
    const dashboardRows = Array.from({ length: rows }, (_, index) => ({
      key: `row-${index}`,
      text: `row-${index.toString().padStart(2, "0")}`,
    }));
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={columns} height={rows}>
          {dashboardRows.map((row) => (
            <Text key={row.key}>{row.text}</Text>
          ))}
          <OverlayLayer activeOverlay="help" columns={columns} rows={rows} />
        </Box>,
        { columns },
      ),
    );
    const lines = frame.split("\n");

    expect(lines).toHaveLength(rows);
    expect(lines[0]).toContain("row-00");
    expect(lines[1]).toContain("row-01");
    expect(lines.at(-1)).toContain("row-11");
    expect(frame).toContain("wosm help");
  });

  it("renders nothing when no overlay is active", () => {
    const rows = 4;
    const columns = 40;
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={columns} height={rows}>
          <Text>top</Text>
          <Text>bottom</Text>
          <OverlayLayer activeOverlay={undefined} columns={columns} rows={rows} />
        </Box>,
        { columns },
      ),
    );

    expect(frame.split("\n")).toHaveLength(4);
    expect(frame).toContain("top");
    expect(frame).toContain("bottom");
    expect(frame).not.toContain("wosm help");
  });
});

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
