import { useInput, useStdout } from "ink";
import { useEffect } from "react";

const SGR_MOUSE_ENABLE = "\u001B[?1000h\u001B[?1006h";
const SGR_MOUSE_DISABLE = "\u001B[?1006l\u001B[?1000l";

export type MouseScrollDirection = "up" | "down";

export function useMouseWheelInput(onScroll: (direction: MouseScrollDirection) => void): void {
  const { stdout, write } = useStdout();

  useEffect(() => {
    if (!stdout.isTTY) {
      return;
    }
    write(SGR_MOUSE_ENABLE);
    return () => {
      write(SGR_MOUSE_DISABLE);
    };
  }, [stdout, write]);

  useInput((input) => {
    const direction = parseSgrMouseScroll(input);
    if (direction !== undefined) {
      onScroll(direction);
    }
  });
}

export function parseSgrMouseScroll(input: string): MouseScrollDirection | undefined {
  const sequence = input.startsWith("\u001B") ? input.slice(1) : input;
  const match = /^\[<(\d+);\d+;\d+M$/.exec(sequence);
  if (match === null) {
    return undefined;
  }
  const button = Number(match[1]);
  if (button === 64) {
    return "up";
  }
  if (button === 65) {
    return "down";
  }
  return undefined;
}
