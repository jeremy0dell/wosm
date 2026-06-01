import type { BoxProps } from "ink";
import { Box, Text } from "ink";

export type FloatingBlankBackgroundProps = {
  left: number;
  top: number;
  width: number;
  height: number;
  backgroundColor?: BoxProps["backgroundColor"];
};

export function FloatingBlankBackground({
  left,
  top,
  width,
  height,
  backgroundColor,
}: FloatingBlankBackgroundProps) {
  if (width <= 0 || height <= 0) {
    return null;
  }

  return (
    <Box
      position="absolute"
      left={left}
      top={top}
      width={width}
      height={height}
      flexDirection="column"
      overflow="hidden"
    >
      {floatingBlankBackgroundRows({ width, height }).map((row) =>
        backgroundColor === undefined ? (
          <Text key={row.key}>{row.line}</Text>
        ) : (
          <Text key={row.key} backgroundColor={backgroundColor}>
            {row.line}
          </Text>
        ),
      )}
    </Box>
  );
}

function floatingBlankBackgroundRows(input: {
  width: number;
  height: number;
}): Array<{ key: string; line: string }> {
  return Array.from({ length: input.height }, (_unused, index) => ({
    key: `floating-blank-background-${index}`,
    line: " ".repeat(input.width),
  }));
}
