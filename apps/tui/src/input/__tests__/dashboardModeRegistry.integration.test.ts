import { describe, expect, it } from "vitest";
import { createInitialUiState } from "../../uiState.js";
import { overlayRenderState } from "../dashboardInput.js";
import { dashboardInputModes } from "../dashboardModeRegistry.js";
import { isReturnInput } from "../keyEvents.js";

describe("dashboard input modes", () => {
  it("keeps modal input handlers ahead of dashboard shortcuts", () => {
    expect(dashboardInputModes.map((mode) => mode.name)).toEqual([
      "new-session",
      "prompt",
      "help-overlay",
      "dashboard",
    ]);
  });

  it("recognizes return input forms for shared handlers", () => {
    expect(isReturnInput({ input: "", key: { return: true } })).toBe(true);
    expect(isReturnInput({ input: "\r", key: {} })).toBe(true);
    expect(isReturnInput({ input: "\n", key: {} })).toBe(true);
    expect(isReturnInput({ input: "n", key: {} })).toBe(false);
  });

  it("keeps overlay rendering derived from UI and new-session state", () => {
    expect(
      overlayRenderState(
        undefined,
        { ...createInitialUiState(), activeOverlay: "help" },
        undefined,
      ),
    ).toEqual({ type: "help" });
    expect(overlayRenderState(undefined, createInitialUiState(), undefined)).toBeUndefined();
  });
});
