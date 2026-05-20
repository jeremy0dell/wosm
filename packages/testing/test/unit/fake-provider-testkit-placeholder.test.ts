import { createFakeProviderTestkitPlaceholder } from "@wosm/testing";
import { describe, expect, it } from "vitest";

describe("Phase 0 fake provider testkit skeleton", () => {
  it("declares fake provider categories without implementing provider behavior", () => {
    expect(createFakeProviderTestkitPlaceholder()).toEqual({
      phase: "0",
      status: "placeholder",
      providers: ["fake-worktree", "fake-terminal", "fake-harness"],
    });
  });
});
