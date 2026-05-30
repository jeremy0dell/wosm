import { describe, expect, it } from "vitest";
import { closeOverlay, createInitialUiState, openHelpOverlay, openPrompt } from "./uiState.js";

describe("TUI UI state", () => {
  it("opens and closes help without materializing undefined optional fields", () => {
    const opened = openHelpOverlay(createInitialUiState());
    expect(opened.activeOverlay).toBe("help");
    expect(Object.hasOwn(opened, "prompt")).toBe(false);

    const closed = closeOverlay(opened);
    expect(Object.hasOwn(closed, "activeOverlay")).toBe(false);
    expect(Object.hasOwn(closed, "prompt")).toBe(false);
  });

  it("does not open help over prompt modes", () => {
    const prompted = openPrompt(createInitialUiState(), "search");
    const next = openHelpOverlay(prompted);

    expect(next).toBe(prompted);
    expect(next.prompt).toEqual({ mode: "search", value: "" });
    expect(Object.hasOwn(next, "activeOverlay")).toBe(false);
  });

  it("opens project-collapse prompts with supplied project slot text", () => {
    const next = openPrompt(createInitialUiState(), "project-collapse", "1:web 2:api");

    expect(next.prompt).toEqual({ mode: "project-collapse", value: "1:web 2:api" });
  });
});
