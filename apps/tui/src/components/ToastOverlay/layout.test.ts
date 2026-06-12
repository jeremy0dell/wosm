import { toastOverlayLayout } from "@wosm/dashboard-core";
import { describe, expect, it } from "vitest";

describe("toastOverlayLayout", () => {
  it("places a normal-width toast in the lower right above the footer", () => {
    expect(
      toastOverlayLayout({
        columns: 80,
        rows: 20,
        promptRows: 0,
        contentRows: 2,
      }),
    ).toEqual({
      left: 26,
      top: 13,
      width: 52,
      height: 4,
      contentWidth: 50,
    });
  });

  it("centers the toast at narrow widths", () => {
    expect(
      toastOverlayLayout({
        columns: 44,
        rows: 16,
        promptRows: 0,
        contentRows: 2,
      }),
    ).toMatchObject({
      left: 2,
      width: 40,
    });
  });

  it("reserves prompt rows above the footer", () => {
    const withoutPrompt = toastOverlayLayout({
      columns: 80,
      rows: 20,
      promptRows: 0,
      contentRows: 2,
    });
    const withPrompt = toastOverlayLayout({
      columns: 80,
      rows: 20,
      promptRows: 2,
      contentRows: 2,
    });

    expect(withPrompt?.top).toBe((withoutPrompt?.top ?? 0) - 2);
  });

  it("returns no layout when the terminal is too short", () => {
    expect(
      toastOverlayLayout({
        columns: 80,
        rows: 8,
        promptRows: 0,
        contentRows: 3,
      }),
    ).toBeUndefined();
  });
});
