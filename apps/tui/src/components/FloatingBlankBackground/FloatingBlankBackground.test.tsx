import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { FloatingBlankBackground } from "./FloatingBlankBackground.js";

describe("FloatingBlankBackground", () => {
  it("paints a blank absolute backing over existing terminal cells", () => {
    const rawFrame = renderToString(
      <Box position="relative" flexDirection="column" width={12} height={4}>
        <Text>BACKGROUND</Text>
        <Text>BACKGROUND</Text>
        <Text>BACKGROUND</Text>
        <Text>BACKGROUND</Text>
        <FloatingBlankBackground left={0} top={1} width={12} height={2} />
      </Box>,
      { columns: 12 },
    );
    const frame = stripAnsi(rawFrame);

    expect(frame).toBe("BACKGROUND\n\n\nBACKGROUND");
    expect(rawFrame).not.toContain(`${String.fromCharCode(27)}[40m`);
  });

  it("supports an explicit backing color when a caller needs one", () => {
    const rawFrame = renderToString(
      <Box position="relative" flexDirection="column" width={12} height={4}>
        <Text>BACKGROUND</Text>
        <Text>BACKGROUND</Text>
        <Text>BACKGROUND</Text>
        <Text>BACKGROUND</Text>
        <FloatingBlankBackground left={0} top={1} width={12} height={2} backgroundColor="black" />
      </Box>,
      { columns: 12 },
    );

    expect(stripAnsi(rawFrame)).toBe("BACKGROUND\n\n\nBACKGROUND");
  });
});

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
