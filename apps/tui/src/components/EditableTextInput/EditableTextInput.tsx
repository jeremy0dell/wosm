import { Text } from "ink";
import { TuiCursor } from "../TuiCursor/TuiCursor.js";
import { clampEditableTextCursor, type EditableTextInputState } from "./editing.js";

export type EditableTextInputProps = EditableTextInputState & {
  placeholder?: string;
  placeholderColor?: "gray" | "yellow" | "red";
};

export function EditableTextInput({
  value,
  cursor,
  placeholder,
  placeholderColor = "gray",
}: EditableTextInputProps) {
  if (value.length === 0 && placeholder !== undefined) {
    return (
      <>
        <TuiCursor />
        <Text color={placeholderColor}>{placeholder}</Text>
      </>
    );
  }

  const clampedCursor = clampEditableTextCursor(cursor, value);
  return (
    <>
      <Text>{value.slice(0, clampedCursor)}</Text>
      <TuiCursor />
      <Text>{value.slice(clampedCursor)}</Text>
    </>
  );
}
