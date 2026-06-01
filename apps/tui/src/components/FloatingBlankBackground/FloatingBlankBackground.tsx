import type { BoxProps } from "ink";
import { Box } from "ink";

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
  backgroundColor = "black",
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
      backgroundColor={backgroundColor}
    />
  );
}
