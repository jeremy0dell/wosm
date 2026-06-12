import { describe, expect, it } from "bun:test";
import { wosmPopupLayout } from "./WosmOverlay.js";

describe("wosmPopupLayout", () => {
  it("centers a half-size popup below the header on a large terminal", () => {
    const layout = wosmPopupLayout(200, 61);
    expect(layout).toEqual({ left: 50, top: 16, width: 100, height: 30 });
  });

  it("clamps to the minimum size the dashboard needs", () => {
    const layout = wosmPopupLayout(100, 30);
    expect(layout.width).toBe(60);
    expect(layout.height).toBe(16);
    expect(layout.left).toBe(20);
    expect(layout.top).toBe(1 + Math.floor((29 - 16) / 2));
  });

  it("never exceeds the available area on tiny terminals", () => {
    const layout = wosmPopupLayout(40, 12);
    expect(layout.width).toBe(40);
    expect(layout.height).toBe(11);
    expect(layout.left).toBe(0);
    expect(layout.top).toBe(1);
  });
});
