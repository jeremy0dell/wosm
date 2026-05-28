export type EditableTextInputState = {
  value: string;
  cursor: number;
};

export function createEditableTextInputState(value = ""): EditableTextInputState {
  return {
    value,
    cursor: value.length,
  };
}

export function insertEditableText(
  state: EditableTextInputState,
  input: string,
): EditableTextInputState {
  const cursor = clampEditableTextCursor(state.cursor, state.value);
  return {
    value: `${state.value.slice(0, cursor)}${input}${state.value.slice(cursor)}`,
    cursor: cursor + input.length,
  };
}

export function backspaceEditableText(state: EditableTextInputState): EditableTextInputState {
  const cursor = clampEditableTextCursor(state.cursor, state.value);
  if (cursor === 0) {
    return cursor === state.cursor ? state : { ...state, cursor };
  }
  return {
    value: `${state.value.slice(0, cursor - 1)}${state.value.slice(cursor)}`,
    cursor: cursor - 1,
  };
}

export function deleteEditableText(state: EditableTextInputState): EditableTextInputState {
  const cursor = clampEditableTextCursor(state.cursor, state.value);
  if (cursor >= state.value.length) {
    return cursor === state.cursor ? state : { ...state, cursor };
  }
  return {
    value: `${state.value.slice(0, cursor)}${state.value.slice(cursor + 1)}`,
    cursor,
  };
}

export function moveEditableTextCursor(
  state: EditableTextInputState,
  delta: number,
): EditableTextInputState {
  return {
    ...state,
    cursor: clampEditableTextCursor(state.cursor + delta, state.value),
  };
}

export function clampEditableTextCursor(cursor: number, value: string): number {
  return Math.min(Math.max(0, cursor), value.length);
}
