import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { FloatingBlankBackground } from "./FloatingBlankBackground.js";

describe("FloatingBlankBackground", () => {
  it("paints a blank absolute backing over existing terminal cells", () => {
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={12} height={4}>
          <Text>BACKGROUND</Text>
          <Text>BACKGROUND</Text>
          <Text>BACKGROUND</Text>
          <Text>BACKGROUND</Text>
          <FloatingBlankBackground left={0} top={1} width={12} height={2} />
        </Box>,
        { columns: 12 },
      ),
    );

    expect(frame).toBe("BACKGROUND\n\n\nBACKGROUND");
  });
});

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
