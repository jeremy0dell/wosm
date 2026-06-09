import { useInput, useStdout } from "ink";
import { useEffect } from "react";

export const SGR_MOUSE_ENABLE = "\u001B[?1000h\u001B[?1006h";
export const SGR_MOUSE_DISABLE =
  "\u001B[?1000l\u001B[?1002l\u001B[?1003l\u001B[?1005l\u001B[?1006l\u001B[?1015l";

export type MouseScrollDirection = "up" | "down";

export type MouseWheelInputOptions = {
  enabled?: boolean;
};

export function useMouseWheelInput(
  onScroll: (direction: MouseScrollDirection) => void,
  options: MouseWheelInputOptions = {},
): void {
  const { stdout, write } = useStdout();
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!stdout.isTTY) {
      return;
    }
    write(mouseTrackingSetupSequence(enabled));
    if (!enabled) {
      return;
    }
    return () => {
      write(SGR_MOUSE_DISABLE);
    };
  }, [enabled, stdout, write]);

  useInput((input) => {
    if (!enabled) {
      return;
    }
    const direction = parseSgrMouseScroll(input);
    if (direction !== undefined) {
      onScroll(direction);
    }
  });
}

export function mouseTrackingSetupSequence(enabled: boolean): string {
  return enabled ? `${SGR_MOUSE_DISABLE}${SGR_MOUSE_ENABLE}` : SGR_MOUSE_DISABLE;
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
