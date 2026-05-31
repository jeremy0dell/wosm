import { describe, expect, it } from "vitest";
import { parseSgrMouseScroll } from "./useMouseWheelInput.js";

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
});
