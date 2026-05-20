import { loadPhaseZeroConfig } from "@wosm/config";
import { describe, expect, it } from "vitest";

describe("Phase 0 config skeleton", () => {
  it("loads a placeholder config without reading user configuration", () => {
    expect(loadPhaseZeroConfig()).toEqual({
      phase: "0",
      projects: [],
      source: "placeholder",
    });
  });
});
