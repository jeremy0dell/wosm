// Renders the shared layout's RowSegment vocabulary with OpenTUI styled
// spans — the one place Ink's {color, dimColor, underline, url} segment
// props meet OpenTUI's {fg, attributes}. PR urls render as underlined text
// (no OSC8 link yet); upstream's Link wrapper is cosmetic there too.
import { TextAttributes } from "@opentui/core";
import type { RowSegment } from "@wosm/dashboard-core";
import { rowColorToHex } from "./theme.js";
import { Throbber } from "./Throbber.js";

export function Segments({ segments }: { segments: readonly RowSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <Segment key={segmentKey(segment, index)} segment={segment} />
      ))}
    </>
  );
}

function segmentKey(segment: RowSegment, index: number): string {
  if (segment.kind === "throbber") {
    return `throbber:${segment.variant}:${index}`;
  }
  return `text:${segment.text}:${segment.url ?? ""}:${index}`;
}

function Segment({ segment }: { segment: RowSegment }) {
  if (segment.kind === "throbber") {
    return <Throbber variant={segment.variant} />;
  }
  let attributes = TextAttributes.NONE;
  if (segment.dimColor === true) {
    attributes |= TextAttributes.DIM;
  }
  if (segment.underline === true) {
    attributes |= TextAttributes.UNDERLINE;
  }
  const fg = rowColorToHex(segment.color);
  return (
    <span {...(fg === undefined ? {} : { fg })} attributes={attributes}>
      {segment.text}
    </span>
  );
}
