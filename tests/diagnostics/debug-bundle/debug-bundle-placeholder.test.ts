import { createDebugBundlePlaceholder } from "@wosm/observability";
import { describe, expect, it } from "vitest";

describe("Phase 0 debug bundle skeleton", () => {
  it("declares minimum debug bundle sections without collecting runtime data", () => {
    expect(createDebugBundlePlaceholder()).toEqual({
      phase: "0",
      status: "placeholder",
      sections: ["manifest", "config-summary", "health", "redaction-report"],
    });
  });
});
