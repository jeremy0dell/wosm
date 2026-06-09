import { Text } from "ink";
import { memo, useCallback, useSyncExternalStore } from "react";

export type ThrobberVariant = "circle" | "braille" | "attention" | "dots";

export type ThrobberProps = {
  variant: ThrobberVariant;
};

const DEFAULT_INTERVAL_MS = 120;

const CIRCLE_FRAMES = ["◜", "◠", "◝", "◞", "◡", "◟"] as const satisfies NonEmptyList<string>;
const BRAILLE_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const satisfies NonEmptyList<string>;
const DOT_FRAMES = [".  ", ".. ", "..."] as const satisfies NonEmptyList<string>;
const ATTENTION_STYLES = [
  { color: "red", dimColor: true },
  { color: "red" },
  { color: "red", bold: true },
  { color: "red" },
] as const satisfies NonEmptyList<AttentionStyle>;

export const Throbber = memo(function Throbber({ variant }: ThrobberProps) {
  const frameTick = useAnimationTick(variant === "attention" ? 2 : 1);

  if (variant === "attention") {
    const style = cycle(ATTENTION_STYLES, frameTick);
    return <Text {...style}>!</Text>;
  }

  const frames =
    variant === "dots" ? DOT_FRAMES : variant === "circle" ? CIRCLE_FRAMES : BRAILLE_FRAMES;
  return <Text>{cycle(frames, frameTick)}</Text>;
});

type NonEmptyList<T> = readonly [T, ...T[]];

type AttentionStyle = {
  color: "red";
  dimColor?: true;
  bold?: true;
};

const animationClock = createAnimationClock();

type AnimationClock = {
  getSnapshot: () => number;
  subscribe: (listener: () => void) => () => void;
};

function createAnimationClock(): AnimationClock {
  let tick = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function start() {
    if (interval !== undefined) return;
    interval = setInterval(() => {
      tick += 1;
      emit();
    }, DEFAULT_INTERVAL_MS);
  }

  function stop() {
    if (interval === undefined) return;
    clearInterval(interval);
    interval = undefined;
    tick = 0;
  }

  return {
    getSnapshot: () => tick,
    subscribe: (listener) => {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop();
        }
      };
    },
  };
}

function useAnimationTick(divisor: number): number {
  const getSnapshot = useCallback(
    () => Math.floor(animationClock.getSnapshot() / divisor),
    [divisor],
  );
  return useSyncExternalStore(animationClock.subscribe, getSnapshot, getSnapshot);
}

function cycle<T>(values: NonEmptyList<T>, tick: number): T {
  const index = positiveModulo(tick, values.length);
  return values[index] ?? values[0];
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
