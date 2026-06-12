// OpenTUI port of apps/tui's HelpOverlay: centered box-drawn panel above the
// dashboard (absolute + zIndex; the dashboard must never reflow for it).
// Lines come from the ported panel generator over the keymap's help content.
import { WOSM_HELP_CONTENT } from "../input/wosmKeymap.js";
import { helpPanelLayout, helpPanelLines } from "../ported/components/HelpOverlay/helpPanel.js";
import { WOSM_COLORS } from "./theme.js";
import { useWosmMouse, wosmMouseProps } from "./wosmMouseContext.js";

export function HelpOverlayView({ columns, rows }: { columns: number; rows: number }) {
  const dispatch = useWosmMouse();
  const layout = helpPanelLayout(columns, rows, WOSM_HELP_CONTENT);
  const panelLines = helpPanelLines(layout.width, layout.height, WOSM_HELP_CONTENT);

  return (
    <box
      position="absolute"
      top={layout.top}
      left={layout.left}
      width={layout.width}
      height={layout.height}
      zIndex={10}
      flexDirection="column"
      backgroundColor="#000000"
      {...wosmMouseProps(dispatch, { kind: "sheetBackdrop" })}
    >
      {panelLines.map((line, index) => (
        <text key={`${index}:${line}`} fg={WOSM_COLORS.foreground} bg="#000000">
          {line}
        </text>
      ))}
    </box>
  );
}
