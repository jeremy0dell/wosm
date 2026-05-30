import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { CommandPrompt } from "./CommandPrompt.js";

describe("CommandPrompt", () => {
  it("renders nothing without an active prompt", () => {
    expect(renderToString(<CommandPrompt prompt={undefined} />)).toBe("");
  });

  it.each([
    ["search", "search: mobile"],
    ["remove-slot", "remove slot: 3"],
    ["project-collapse", "collapse project: web"],
  ] as const)("labels %s prompts", (mode, expected) => {
    const frame = renderToString(
      <CommandPrompt prompt={{ mode, value: expected.split(": ")[1] }} />,
    );

    expect(frame).toContain(expected);
  });

  it("renders cleanup confirmation labels", () => {
    const frame = renderToString(
      <CommandPrompt
        prompt={{
          mode: "confirm-cleanup",
          value: "",
          action: "remove-worktree",
          rowId: "wt_web_idle",
          forceRequired: false,
          label: "remove fix-nav-mobile? y/N",
        }}
      />,
    );

    expect(frame).toContain("confirm remove fix-nav-mobile? y/N");
  });
});
