import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { CommandPrompt } from "./CommandPrompt.js";

describe("CommandPrompt", () => {
  it("renders nothing without an active prompt", () => {
    expect(renderToString(<CommandPrompt screen={{ name: "dashboard" }} />)).toBe("");
  });

  it.each([
    [{ name: "search", value: "mobile" } as const, "search: mobile"],
    [{ name: "removeWorktree", step: "chooseSlot" } as const, "remove slot:"],
    [{ name: "projectCollapse", value: "1:web" } as const, "collapse project: 1:web"],
  ])("labels screen prompts", (screen, expected) => {
    const frame = renderToString(<CommandPrompt screen={screen} />);

    expect(frame).toContain(expected);
  });

  it("renders cleanup confirmation labels", () => {
    const frame = renderToString(
      <CommandPrompt
        screen={{
          name: "removeWorktree",
          step: "confirm",
          rowId: "wt_web_idle",
          forceRequired: false,
          label: "remove fix-nav-mobile? Y/N",
        }}
      />,
    );

    expect(frame).toContain("confirm remove fix-nav-mobile? Y/N");
  });
});
