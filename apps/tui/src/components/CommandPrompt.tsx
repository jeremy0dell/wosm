import { Box, Text } from "ink";
import type { TuiPromptState } from "../uiState.js";

export type CommandPromptProps = {
  prompt: TuiPromptState | undefined;
};

export function CommandPrompt({ prompt }: CommandPromptProps) {
  if (prompt === undefined) {
    return null;
  }
  if (prompt.mode === "confirm-cleanup") {
    return (
      <Box marginTop={1}>
        <Text color="red">confirm {prompt.label}</Text>
      </Box>
    );
  }
  const label = textPromptLabel(prompt.mode);
  return (
    <Box marginTop={1}>
      <Text color="yellow">
        {label}: {prompt.value}
      </Text>
    </Box>
  );
}

function textPromptLabel(mode: Exclude<TuiPromptState["mode"], "confirm-cleanup">): string {
  if (mode === "remove-slot") {
    return "remove slot";
  }
  return "search";
}
