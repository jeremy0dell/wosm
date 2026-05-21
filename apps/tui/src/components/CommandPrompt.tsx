import { Box, Text } from "ink";
import type { TuiPromptState } from "../uiState.js";

export type CommandPromptProps = {
  prompt: TuiPromptState | undefined;
};

export function CommandPrompt({ prompt }: CommandPromptProps) {
  if (prompt === undefined) {
    return null;
  }
  const label = prompt.mode === "new-session" ? "new branch" : "search";
  return (
    <Box marginTop={1}>
      <Text color="yellow">
        {label}: {prompt.value}
      </Text>
    </Box>
  );
}
