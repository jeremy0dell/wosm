import { createScriptedAgentLifecyclePlaceholder } from "@wosm/testing";
import { describe, expect, it } from "vitest";

describe("Phase 0 scripted-agent skeleton", () => {
  it("declares lifecycle states without launching an agent", () => {
    expect(createScriptedAgentLifecyclePlaceholder()).toEqual({
      phase: "0",
      status: "placeholder",
      states: ["defined", "started", "stopped"],
    });
  });
});
