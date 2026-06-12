import { commandPromptLineForScreen, type TuiScreen } from "@wosm/dashboard-core";
import { Box, Text } from "ink";

export type CommandPromptProps = {
  screen: TuiScreen;
};

export function CommandPrompt({ screen }: CommandPromptProps) {
  const line = commandPromptLineForScreen(screen);
  if (line === undefined) {
    return null;
  }
  return (
    <Box marginTop={1}>
      <Text color={line.color}>{line.text}</Text>
    </Box>
  );
}
