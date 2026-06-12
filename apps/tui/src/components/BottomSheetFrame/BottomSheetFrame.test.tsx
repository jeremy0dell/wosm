import { bottomSheetFrameLayout } from "@wosm/dashboard-core";
import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { BottomSheetFrame } from "./BottomSheetFrame.js";

describe("BottomSheetFrame", () => {
  it("hugs the bottom of the terminal frame", () => {
    const layout = bottomSheetFrameLayout({
      columns: 40,
      rows: 12,
      contentRows: 4,
      minHeight: 7,
    });
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={40} height={12}>
          <BottomSheetFrame columns={40} rows={12} title="Rename Session" contentRows={4}>
            <Text>content</Text>
          </BottomSheetFrame>
        </Box>,
        { columns: 40 },
      ),
    );
    const lines = frame.split("\n");

    expect(layout).toEqual({ left: 0, top: 5, width: 40, height: 7 });
    expect(lines).toHaveLength(12);
    expect(lines.slice(0, layout.top).join("").trim()).toBe("");
    expect(lines[layout.top]).toContain("╭");
    expect(frame).toContain("Rename Session");
    expect(frame).toContain("content");
  });

  it("clips content within the bottom sheet bounds", () => {
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={30} height={6}>
          <BottomSheetFrame columns={30} rows={6} title="Sheet" contentRows={10}>
            {Array.from({ length: 10 }, (_, index) => {
              const line = `line-${index}`;
              return <Text key={line}>{line}</Text>;
            })}
          </BottomSheetFrame>
        </Box>,
        { columns: 30 },
      ),
    );
    const lines = frame.split("\n");

    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain("╭");
    expect(frame).toContain("line-0");
    expect(frame).not.toContain("line-9");
  });

  it("paints an opaque backing over dashboard text", () => {
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={38} height={8}>
          {backgroundRows().map((key) => (
            <Text key={key}>{"BACKGROUND".repeat(4)}</Text>
          ))}
          <BottomSheetFrame columns={38} rows={8} title="Sheet" contentRows={6}>
            <Text>short</Text>
          </BottomSheetFrame>
        </Box>,
        { columns: 38 },
      ),
    );
    const lines = frame.split("\n");

    expect(lines).toHaveLength(8);
    expect(frame).toContain("short");
    expect(frame).not.toContain("BACKGROUND");
  });
});

function backgroundRows(): string[] {
  return Array.from({ length: 8 }, (_unused, index) => `background-${index}`);
}

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
