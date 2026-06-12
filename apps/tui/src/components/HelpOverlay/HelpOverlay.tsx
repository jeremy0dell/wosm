import { helpPanelLayout, helpPanelLines, TUI_HELP_CONTENT } from "@wosm/dashboard-core";
import { Box, Text } from "ink";

export type HelpOverlayProps = {
  columns: number;
  rows: number;
};

export function HelpOverlay({ columns, rows }: HelpOverlayProps) {
  const layout = helpPanelLayout(columns, rows, TUI_HELP_CONTENT);
  const panelLines = helpPanelLines(layout.width, layout.height, TUI_HELP_CONTENT);

  return (
    <Box
      position="absolute"
      top={layout.top}
      left={layout.left}
      flexDirection="column"
      width={layout.width}
      height={layout.height}
      overflow="hidden"
    >
      {panelLines.map((line, index) => (
        <Text key={lineKey(line, index)} backgroundColor="black">
          {line}
        </Text>
      ))}
    </Box>
  );
}

function lineKey(line: string, index: number): string {
  return `${index}:${line}`;
}
