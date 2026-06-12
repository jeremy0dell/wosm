import type { WorktreeRow as WorktreeRowModel } from "@wosm/contracts";
import {
  layoutWorktreeRowGrid,
  type RowColor,
  type RowGridLayout,
  type RowSegment,
  worktreeRowGridInput,
} from "@wosm/dashboard-core";
import { Box, Text } from "ink";
import { Link } from "../Link/Link.js";
import { Throbber } from "../Throbber/Throbber.js";

export type WorktreeRowProps = {
  row: WorktreeRowModel;
  slot: string | undefined;
  title?: string | undefined;
  columns?: number | undefined;
};

export function WorktreeRow({ row, slot, title, columns = 80 }: WorktreeRowProps) {
  const input = worktreeRowGridInput({ row, slot, title });
  const layout = layoutWorktreeRowGrid({ columns, rows: [input] })[0];
  return layout === undefined ? null : <WorktreeRowLayoutView layout={layout} />;
}

export function WorktreeRowLayoutView({ layout }: { layout: RowGridLayout }) {
  return (
    <Box flexShrink={0}>
      <Segments segments={layout.segments} />
    </Box>
  );
}

function Segments({ segments }: { segments: readonly RowSegment[] }) {
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
  const props: {
    color?: RowColor;
    dimColor?: true;
    underline?: true;
  } = {};
  if (segment.color !== undefined) props.color = segment.color;
  if (segment.dimColor === true) props.dimColor = true;
  if (segment.underline === true) props.underline = true;
  const rendered = <Text {...props}>{segment.text}</Text>;
  return segment.url === undefined ? rendered : <Link url={segment.url}>{rendered}</Link>;
}
