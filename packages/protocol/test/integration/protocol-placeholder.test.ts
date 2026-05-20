import { createProtocolSmokePlaceholder } from "@wosm/protocol";
import { describe, expect, it } from "vitest";

describe("Phase 0 protocol skeleton", () => {
  it("exposes a client/server smoke placeholder without opening a transport", () => {
    expect(createProtocolSmokePlaceholder()).toEqual({
      phase: "0",
      status: "placeholder",
      contractSurfaceCount: 5,
    });
  });
});
