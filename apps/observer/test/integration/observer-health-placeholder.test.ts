import { getObserverHealthPlaceholder } from "@wosm/observer";
import { describe, expect, it } from "vitest";

describe("Phase 0 observer skeleton", () => {
  it("reports placeholder health without starting an observer daemon", () => {
    expect(getObserverHealthPlaceholder()).toEqual({
      phase: "0",
      status: "ok",
      behavior: "placeholder",
    });
  });
});
