import { phaseZeroContracts } from "@wosm/contracts";
import { describe, expect, it } from "vitest";

describe("Phase 0 contract skeleton", () => {
  it("declares the future public contract surfaces without implementing schemas", () => {
    expect(phaseZeroContracts).toMatchObject({
      phase: "0",
      status: "placeholder",
    });
    expect(phaseZeroContracts.surfaces).toEqual([
      "snapshot",
      "commands",
      "events",
      "providers",
      "safe-errors",
    ]);
  });
});
