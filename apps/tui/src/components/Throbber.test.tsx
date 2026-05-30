import { renderToString, Text } from "ink";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { Throbber } from "./Throbber.js";

describe("Throbber", () => {
  it.each([
    [0, "◜"],
    [1, "◠"],
    [2, "◝"],
    [3, "◞"],
    [4, "◡"],
    [5, "◟"],
  ])("renders circle frame %s", (tick, frame) => {
    expect(renderThrobberAtTick(tick, "circle")).toBe(frame);
  });

  it.each([
    [0, "⠋"],
    [1, "⠙"],
    [2, "⠹"],
    [3, "⠸"],
    [4, "⠼"],
    [5, "⠴"],
    [6, "⠦"],
    [7, "⠧"],
    [8, "⠇"],
    [9, "⠏"],
  ])("renders braille frame %s", (tick, frame) => {
    expect(renderThrobberAtTick(tick, "braille")).toBe(frame);
  });

  it("uses tick zero before the animation clock starts", () => {
    expect(renderToString(<Throbber variant="circle" />)).toBe("◜");
    expect(renderToString(<Throbber variant="braille" />)).toBe("⠋");
    expect(renderToString(<Throbber variant="attention" />)).toBe("!");
  });

  it.each([
    [0, { children: "!", color: "red", dimColor: true, bold: false }],
    [1, { children: "!", color: "red", dimColor: true, bold: false }],
    [2, { children: "!", color: "red", dimColor: false, bold: false }],
    [4, { children: "!", color: "red", dimColor: false, bold: true }],
    [6, { children: "!", color: "red", dimColor: false, bold: false }],
  ])("renders attention pulse style for tick %s", (tick, expected) => {
    expect(renderThrobberPropsAtTick(tick, "attention")).toEqual(expected);
  });

  it("uses one shared interval for multiple mounted throbbers", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      withReactActEnvironment(() =>
        withSuppressedReactTestRendererWarning(() => {
          let renderer: ReactTestRenderer | undefined;

          act(() => {
            renderer = create(
              <>
                <Throbber variant="circle" />
                <Throbber variant="braille" />
                <Throbber variant="attention" />
              </>,
            );
          });

          expect(setIntervalSpy).toHaveBeenCalledTimes(1);

          act(() => {
            renderer?.unmount();
          });
        }),
      );
    } finally {
      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("ticks throbbers without rerendering their owner", () => {
    vi.useFakeTimers();
    try {
      withReactActEnvironment(() =>
        withSuppressedReactTestRendererWarning(() => {
          const onRender = vi.fn();
          let renderer: ReactTestRenderer | undefined;

          act(() => {
            renderer = create(<ThrobberOwner onRender={onRender} />);
          });

          expect(firstTextContent(required(renderer))).toBe("◜");
          expect(onRender).toHaveBeenCalledTimes(1);

          act(() => {
            vi.advanceTimersByTime(120);
          });

          expect(firstTextContent(required(renderer))).toBe("◠");
          expect(onRender).toHaveBeenCalledTimes(1);

          act(() => {
            renderer?.unmount();
          });
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

type Variant = "circle" | "braille" | "attention";

function renderThrobberAtTick(tick: number, variant: Variant): string {
  return renderThrobberPropsAtTick(tick, variant).children;
}

function renderThrobberPropsAtTick(
  tick: number,
  variant: Variant,
): {
  children: string;
  color: string | undefined;
  dimColor: boolean;
  bold: boolean;
} {
  vi.useFakeTimers();
  try {
    return withReactActEnvironment(() =>
      withSuppressedReactTestRendererWarning(() => inspectThrobberPropsAtTick(tick, variant)),
    );
  } finally {
    vi.useRealTimers();
  }
}

function inspectThrobberPropsAtTick(
  tick: number,
  variant: Variant,
): {
  children: string;
  color: string | undefined;
  dimColor: boolean;
  bold: boolean;
} {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<Throbber variant={variant} />);
  });
  try {
    if (tick > 0) {
      act(() => {
        vi.advanceTimersByTime(tick * 120);
      });
    }
    return textProps(required(renderer));
  } finally {
    act(() => {
      renderer?.unmount();
    });
  }
}

function ThrobberOwner({ onRender }: { onRender: () => void }) {
  onRender();
  return (
    <>
      <Throbber variant="circle" />
      <Text>stable</Text>
    </>
  );
}

function firstTextContent(renderer: ReactTestRenderer): string {
  return textProps(renderer).children;
}

function textProps(renderer: ReactTestRenderer): {
  children: string;
  color: string | undefined;
  dimColor: boolean;
  bold: boolean;
} {
  const text = required(renderer.root.findAllByType(Text).at(0));
  const props = text.props as {
    children: string;
    color?: string;
    dimColor?: boolean;
    bold?: boolean;
  };
  return {
    children: props.children,
    color: props.color,
    dimColor: props.dimColor === true,
    bold: props.bold === true,
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected value to exist.");
  }
  return value;
}

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function withReactActEnvironment<T>(callback: () => T): T {
  const actGlobal = globalThis as ReactActGlobal;
  const hadActEnvironment = "IS_REACT_ACT_ENVIRONMENT" in actGlobal;
  const previousActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    return callback();
  } finally {
    if (hadActEnvironment) {
      actGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    } else {
      delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
    }
  }
}

function withSuppressedReactTestRendererWarning<T>(callback: () => T): T {
  const originalError = console.error;
  const errorSpy = vi.spyOn(console, "error").mockImplementation((message?: unknown, ...rest) => {
    if (typeof message === "string" && message.includes("react-test-renderer is deprecated")) {
      return;
    }
    originalError(message, ...rest);
  });
  try {
    return callback();
  } finally {
    errorSpy.mockRestore();
  }
}
