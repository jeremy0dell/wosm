import { describe, expect, it } from "vitest";
import {
  mouseTrackingSetupSequence,
  parseSgrMouseScroll,
  SGR_MOUSE_DISABLE,
  SGR_MOUSE_ENABLE,
} from "./useMouseWheelInput.js";

describe("mouse wheel input", () => {
  it("parses SGR mouse wheel button sequences", () => {
    expect(parseSgrMouseScroll("\u001B[<64;12;4M")).toBe("up");
    expect(parseSgrMouseScroll("[<65;12;4M")).toBe("down");
  });

  it("ignores non-wheel and release mouse sequences", () => {
    expect(parseSgrMouseScroll("[<0;12;4M")).toBeUndefined();
    expect(parseSgrMouseScroll("[<64;12;4m")).toBeUndefined();
    expect(parseSgrMouseScroll("\u001B[B")).toBeUndefined();
  });

  it("disables all common terminal mouse tracking modes", () => {
    expect(SGR_MOUSE_DISABLE).toContain("\u001B[?1000l");
    expect(SGR_MOUSE_DISABLE).toContain("\u001B[?1002l");
    expect(SGR_MOUSE_DISABLE).toContain("\u001B[?1003l");
    expect(SGR_MOUSE_DISABLE).toContain("\u001B[?1005l");
    expect(SGR_MOUSE_DISABLE).toContain("\u001B[?1006l");
    expect(SGR_MOUSE_DISABLE).toContain("\u001B[?1015l");
  });

  it("does not enable terminal mouse tracking when disabled", () => {
    expect(mouseTrackingSetupSequence(false)).toBe(SGR_MOUSE_DISABLE);
    expect(mouseTrackingSetupSequence(false)).not.toContain(SGR_MOUSE_ENABLE);
    expect(mouseTrackingSetupSequence(true)).toContain(SGR_MOUSE_ENABLE);
  });
});
