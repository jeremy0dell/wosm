import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { ToastStack } from "./ToastStack.js";

describe("ToastStack", () => {
  it("renders nothing without toasts", () => {
    expect(renderToString(<ToastStack toasts={[]} />)).toBe("");
  });

  it("renders only the three newest toasts", () => {
    const frame = renderToString(
      <ToastStack
        toasts={[
          { kind: "info", message: "oldest" },
          { kind: "success", message: "newer" },
          { kind: "error", message: "newest" },
          { kind: "info", message: "latest" },
        ]}
      />,
    );

    expect(frame).not.toContain("oldest");
    expect(frame).toContain("newer");
    expect(frame).toContain("newest");
    expect(frame).toContain("latest");
  });

  it("formats hint, trace, and diagnostic details", () => {
    const frame = renderToString(
      <ToastStack
        toasts={[
          {
            kind: "error",
            message: "focus failed",
            hint: "refresh",
            traceId: "trc_1",
            diagnosticId: "diag_1",
          },
        ]}
      />,
    );

    expect(frame).toContain("focus failed (refresh | trace trc_1 | diagnostic diag_1)");
  });
});
