import { createEditableTextInputState } from "@wosm/dashboard-core";
import { Box, renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { RenameSessionBottomSheet } from "./RenameSessionBottomSheet.js";

describe("RenameSessionBottomSheet", () => {
  it("renders only the editable name field and footer", () => {
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={72} height={14}>
          <RenameSessionBottomSheet
            columns={72}
            rows={14}
            state={{
              name: "renameSession",
              step: "editName",
              rowId: "wt_web_idle",
              sessionId: "ses_wt_web_idle",
              currentTitle: "Readable feature task",
              draftTitle: createEditableTextInputState("Readable feature task"),
            }}
          />
        </Box>,
        { columns: 72 },
      ),
    );

    expect(frame).toContain("Rename Session");
    expect(frame).toContain("Name      Readable feature task|");
    expect(frame).toContain("Enter:rename   Esc:back");
    expect(frame).not.toContain("Project");
    expect(frame).not.toContain("Agent");
  });

  it("keeps the footer visible in a short terminal", () => {
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={36} height={6}>
          <RenameSessionBottomSheet
            columns={36}
            rows={6}
            state={{
              name: "renameSession",
              step: "editName",
              rowId: "wt_web_idle",
              sessionId: "ses_wt_web_idle",
              currentTitle: "Readable feature task",
              draftTitle: createEditableTextInputState("Readable feature task"),
            }}
          />
        </Box>,
        { columns: 36 },
      ),
    );

    expect(frame.split("\n")).toHaveLength(6);
    expect(frame).toContain("Rename Session");
    expect(frame).toContain("Enter:rename");
  });

  it("renders validation feedback inside the sheet", () => {
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={72} height={14}>
          <RenameSessionBottomSheet
            columns={72}
            rows={14}
            state={{
              name: "renameSession",
              step: "editName",
              rowId: "wt_web_idle",
              sessionId: "ses_wt_web_idle",
              currentTitle: "Readable feature task",
              draftTitle: createEditableTextInputState("   "),
              validationError: "Session title cannot be empty.",
            }}
          />
        </Box>,
        { columns: 72 },
      ),
    );

    expect(frame).toContain("Session title cannot be empty.");
    expect(frame).toContain("Enter:rename   Esc:back");
  });
});

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
