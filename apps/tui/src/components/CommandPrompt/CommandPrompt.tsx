import { Box, Text } from "ink";
import type { TuiScreen } from "../../state/screen.js";

export type CommandPromptProps = {
  screen: TuiScreen;
};

export function CommandPrompt({ screen }: CommandPromptProps) {
  if (screen.name === "removeWorktree" && screen.step === "confirm") {
    return (
      <Box marginTop={1}>
        <Text color="red">confirm {screen.label}</Text>
      </Box>
    );
  }

  const prompt = textPromptForScreen(screen);
  if (prompt === undefined) {
    return null;
  }

  return (
    <Box marginTop={1}>
      <Text color="yellow">
        {prompt.label}: {prompt.value}
      </Text>
    </Box>
  );
}

function textPromptForScreen(screen: TuiScreen): { label: string; value: string } | undefined {
  if (screen.name === "removeWorktree" && screen.step === "chooseSlot") {
    return { label: "remove slot", value: "" };
  }
  if (screen.name === "search") {
    return { label: "search", value: screen.value };
  }
  if (screen.name === "projectCollapse") {
    return { label: "collapse project", value: screen.value };
  }
  return undefined;
}
