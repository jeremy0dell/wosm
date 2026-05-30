import { Box, renderToString } from "ink";
import { describe, expect, it, test } from "vitest";
import { EditableTextInput } from "./EditableTextInput.js";
import {
  backspaceEditableText,
  clampEditableTextCursor,
  createEditableTextInputState,
  deleteEditableText,
  editableTextInputIntentForInput,
  insertEditableText,
  moveEditableTextCursor,
  transitionEditableTextInput,
} from "./editing.js";

describe("EditableTextInput", () => {
  it("renders the cursor at the end of text", () => {
    const frame = renderToString(
      <Box>
        <EditableTextInput cursor={11} value="feature/foo" />
      </Box>,
      { columns: 40 },
    );

    expect(frame).toBe("feature/foo|");
  });

  it("renders the cursor inside text", () => {
    const frame = renderToString(
      <Box>
        <EditableTextInput cursor={8} value="feature/foo" />
      </Box>,
      { columns: 40 },
    );

    expect(frame).toBe("feature/|foo");
  });

  it("renders a placeholder after the cursor for empty text", () => {
    const frame = renderToString(
      <Box>
        <EditableTextInput cursor={0} placeholder="web-k7p3x9" value="" />
      </Box>,
      { columns: 40 },
    );

    expect(frame).toBe("|web-k7p3x9");
  });

  it("clamps rendered cursors before slicing text", () => {
    expect(renderInput({ value: "abc", cursor: -4 })).toBe("|abc");
    expect(renderInput({ value: "abc", cursor: 99 })).toBe("abc|");
  });

  test.each([
    {
      name: "left arrow",
      input: { input: "", key: { leftArrow: true } },
      expected: { type: "edit", action: { type: "moveCursor", delta: -1 } },
    },
    {
      name: "right arrow",
      input: { input: "", key: { rightArrow: true } },
      expected: { type: "edit", action: { type: "moveCursor", delta: 1 } },
    },
    {
      name: "backspace",
      input: { input: "", key: { backspace: true } },
      expected: { type: "edit", action: { type: "backspace" } },
    },
    {
      name: "delete",
      input: { input: "", key: { delete: true } },
      expected: { type: "edit", action: { type: "delete" } },
    },
    {
      name: "typed text",
      input: { input: "abc", key: {} },
      expected: { type: "edit", action: { type: "insert", input: "abc" } },
    },
    {
      name: "empty input",
      input: { input: "", key: {} },
      expected: { type: "none" },
    },
  ])("maps $name to an editable text input intent", ({ input, expected }) => {
    expect(editableTextInputIntentForInput(input)).toEqual(expected);
  });

  test.each([
    {
      name: "start",
      state: { value: "abc", cursor: 0 },
      input: "X",
      expected: { value: "Xabc", cursor: 1 },
    },
    {
      name: "middle",
      state: { value: "abc", cursor: 1 },
      input: "XY",
      expected: { value: "aXYbc", cursor: 3 },
    },
    {
      name: "end",
      state: { value: "abc", cursor: 3 },
      input: "Z",
      expected: { value: "abcZ", cursor: 4 },
    },
    {
      name: "clamped negative cursor",
      state: { value: "abc", cursor: -1 },
      input: "X",
      expected: { value: "Xabc", cursor: 1 },
    },
    {
      name: "clamped overlarge cursor",
      state: { value: "abc", cursor: 99 },
      input: "Z",
      expected: { value: "abcZ", cursor: 4 },
    },
  ])("inserts text at the $name cursor", ({ state, input, expected }) => {
    expect(insertEditableText(state, input)).toEqual(expected);
  });

  test.each([
    {
      name: "start no-op",
      state: { value: "abc", cursor: 0 },
      expected: { value: "abc", cursor: 0 },
    },
    {
      name: "middle removes previous character",
      state: { value: "abc", cursor: 2 },
      expected: { value: "ac", cursor: 1 },
    },
    {
      name: "end removes final character",
      state: { value: "abc", cursor: 3 },
      expected: { value: "ab", cursor: 2 },
    },
    {
      name: "clamped negative cursor no-op",
      state: { value: "abc", cursor: -4 },
      expected: { value: "abc", cursor: 0 },
    },
    {
      name: "clamped overlarge cursor removes final character",
      state: { value: "abc", cursor: 99 },
      expected: { value: "ab", cursor: 2 },
    },
  ])("backspace handles the $name edge", ({ state, expected }) => {
    expect(backspaceEditableText(state)).toEqual(expected);
  });

  test.each([
    {
      name: "start removes first character",
      state: { value: "abc", cursor: 0 },
      expected: { value: "bc", cursor: 0 },
    },
    {
      name: "middle removes next character",
      state: { value: "abc", cursor: 1 },
      expected: { value: "ac", cursor: 1 },
    },
    {
      name: "end no-op",
      state: { value: "abc", cursor: 3 },
      expected: { value: "abc", cursor: 3 },
    },
    {
      name: "clamped negative cursor removes first character",
      state: { value: "abc", cursor: -4 },
      expected: { value: "bc", cursor: 0 },
    },
    {
      name: "clamped overlarge cursor no-op",
      state: { value: "abc", cursor: 99 },
      expected: { value: "abc", cursor: 3 },
    },
  ])("delete handles the $name edge", ({ state, expected }) => {
    expect(deleteEditableText(state)).toEqual(expected);
  });

  test.each([
    {
      name: "left from middle",
      state: { value: "abc", cursor: 2 },
      delta: -1,
      expected: { value: "abc", cursor: 1 },
    },
    {
      name: "right from middle",
      state: { value: "abc", cursor: 1 },
      delta: 1,
      expected: { value: "abc", cursor: 2 },
    },
    {
      name: "left clamps at start",
      state: { value: "abc", cursor: 0 },
      delta: -1,
      expected: { value: "abc", cursor: 0 },
    },
    {
      name: "right clamps at end",
      state: { value: "abc", cursor: 3 },
      delta: 1,
      expected: { value: "abc", cursor: 3 },
    },
    {
      name: "large negative delta clamps",
      state: { value: "abc", cursor: 2 },
      delta: -99,
      expected: { value: "abc", cursor: 0 },
    },
    {
      name: "large positive delta clamps",
      state: { value: "abc", cursor: 1 },
      delta: 99,
      expected: { value: "abc", cursor: 3 },
    },
  ])("moves cursor for $name", ({ state, delta, expected }) => {
    expect(moveEditableTextCursor(state, delta)).toEqual(expected);
  });

  it("clamps cursor values directly", () => {
    expect(clampEditableTextCursor(-10, "abc")).toBe(0);
    expect(clampEditableTextCursor(2, "abc")).toBe(2);
    expect(clampEditableTextCursor(10, "abc")).toBe(3);
  });

  it("updates text around the cursor through the edit reducer", () => {
    const typed = "feature/foo"
      .split("")
      .reduce(
        (state, input) => transitionEditableTextInput(state, { type: "insert", input }),
        createEditableTextInputState(),
      );
    const moved = transitionEditableTextInput(typed, { type: "moveCursor", delta: -3 });
    const inserted = transitionEditableTextInput(moved, { type: "insert", input: "-bar" });
    const backspaced = transitionEditableTextInput(inserted, { type: "backspace" });
    const deleted = transitionEditableTextInput(backspaced, { type: "delete" });

    expect(moved).toEqual({ value: "feature/foo", cursor: 8 });
    expect(inserted).toEqual({ value: "feature/-barfoo", cursor: 12 });
    expect(backspaced).toEqual({ value: "feature/-bafoo", cursor: 11 });
    expect(deleted).toEqual({ value: "feature/-baoo", cursor: 11 });
  });
});

function renderInput(input: { value: string; cursor: number; placeholder?: string }): string {
  return renderToString(
    <Box>
      <EditableTextInput {...input} />
    </Box>,
    { columns: 40 },
  );
}
