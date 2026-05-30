import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { act, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TuiCursor } from "./TuiCursor.js";

type ActEnvironmentGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("TuiCursor", () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    const actGlobal = globalThis as ActEnvironmentGlobal;
    previousActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;
    actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    const actGlobal = globalThis as ActEnvironmentGlobal;
    if (previousActEnvironment === undefined) {
      delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
      return;
    }
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it("renders the visible cursor initially", () => {
    const instance = renderWithAct(<TuiCursor />);

    expect(instance.lastFrame()).toBe("|");
    unmountWithAct(instance);
  });

  it("toggles to a same-width hidden placeholder after the blink interval", () => {
    vi.useFakeTimers();
    const instance = renderWithAct(
      <Box>
        <Text>A</Text>
        <TuiCursor />
        <Text>B</Text>
      </Box>,
    );

    expect(instance.lastFrame()).toBe("A|B");
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(instance.lastFrame()).toBe("A B");
    unmountWithAct(instance);
  });

  it("preserves line width between visible and hidden states", () => {
    vi.useFakeTimers();
    const instance = renderWithAct(
      <Box>
        <Text>name</Text>
        <TuiCursor />
        <Text>end</Text>
      </Box>,
    );
    const visibleFrame = instance.lastFrame() ?? "";

    act(() => {
      vi.advanceTimersByTime(500);
    });
    const hiddenFrame = instance.lastFrame() ?? "";

    expect(visibleFrame).toHaveLength(hiddenFrame.length);
    expect(visibleFrame).toBe("name|end");
    expect(hiddenFrame).toBe("name end");
    unmountWithAct(instance);
  });
});

function renderWithAct(element: ReactElement): ReturnType<typeof render> {
  let instance: ReturnType<typeof render> | undefined;
  act(() => {
    instance = render(element);
  });
  if (instance === undefined) {
    throw new Error("Expected Ink test render result.");
  }
  return instance;
}

function unmountWithAct(instance: ReturnType<typeof render>): void {
  act(() => {
    instance.unmount();
  });
}
