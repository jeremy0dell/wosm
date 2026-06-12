import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { HelpOverlay } from "./HelpOverlay.js";
import { helpPanelLayout, helpPanelLines, TUI_HELP_CONTENT } from "./helpPanel.js";

describe("HelpOverlay", () => {
  it("sizes and centers the panel inside the terminal", () => {
    expect(helpPanelLayout(80, 24, TUI_HELP_CONTENT)).toEqual({
      left: 8,
      top: 4,
      width: 64,
      height: 15,
    });

    expect(helpPanelLayout(36, 12, TUI_HELP_CONTENT)).toEqual({
      left: 2,
      top: 2,
      width: 32,
      height: 8,
    });
  });

  it("renders full-width bordered rows with opaque blank padding", () => {
    const lines = helpPanelLines(36, 8, TUI_HELP_CONTENT);

    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe("╭──────────────────────────────────╮");
    expect(lines.at(-1)).toBe("╰──────────────────────────────────╯");
    expect(lines.every((line) => line.length === 36)).toBe(true);
    expect(lines).toContain("│                                  │");
    expect(lines.join("\n")).toContain("wosm help");
    expect(lines.join("\n")).toContain("↑/↓ wheel  scroll dashboard");
    expect(lines.join("\n")).toContain("1-9/a-z    choose visible item");
    expect(lines.join("\n")).toContain("N          new session");
    expect(helpPanelLines(64, 15, TUI_HELP_CONTENT).join("\n")).toContain(
      "R          rename session",
    );
    expect(helpPanelLines(64, 15, TUI_HELP_CONTENT).join("\n")).toContain(
      "Z          refresh snapshot",
    );
    expect(helpPanelLines(64, 15, TUI_HELP_CONTENT).join("\n")).toContain(
      "Q          quit or close popup",
    );
    expect(lines.join("\n")).not.toContain("Dashboard");
  });

  it("prevents background text from appearing inside panel bounds", () => {
    const columns = 44;
    const rows = 14;
    const backgroundRows = Array.from({ length: rows }, (_, index) => ({
      key: `background-${index}`,
      text: "BACKGROUND-TEXT-BACKGROUND-TEXT-BACKGROUND",
    }));
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={columns} height={rows}>
          {backgroundRows.map((row) => (
            <Text key={row.key}>{row.text}</Text>
          ))}
          <HelpOverlay columns={columns} rows={rows} />
        </Box>,
        { columns },
      ),
    );
    const layout = helpPanelLayout(columns, rows, TUI_HELP_CONTENT);
    const lines = frame.split("\n");

    for (let rowIndex = layout.top; rowIndex < layout.top + layout.height; rowIndex += 1) {
      const segment = (lines[rowIndex] ?? "").slice(layout.left, layout.left + layout.width);
      expect(segment).not.toContain("BACKGROUND");
      expect(segment.length).toBe(layout.width);
    }
  });
});

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
