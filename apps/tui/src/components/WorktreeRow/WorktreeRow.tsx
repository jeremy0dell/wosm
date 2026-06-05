import type { WorktreeRow as WorktreeRowModel } from "@wosm/contracts";
import { Box, Text } from "ink";
import { Link } from "../Link/Link.js";
import { Throbber } from "../Throbber/Throbber.js";
import {
  layoutWorktreeRowGrid,
  type RowColor,
  type RowGridCell,
  type RowGridCellImportance,
  type RowGridCellKey,
  type RowGridLayout,
  type RowGridRowInput,
  type RowMarker,
  type RowSegment,
  textSegment,
  type WorktreeRowMetadataGroups,
} from "./layout.js";

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

export function worktreeRowGridInput({
  id,
  row,
  slot,
  title,
}: WorktreeRowProps & { id?: string }): RowGridRowInput {
  const marker = statusMarker(row);
  const displayTitle = title ?? row.branch;
  const activity = activityCellForRow(row);
  const color = row.display.alert
    ? "red"
    : marker.kind === "text" && marker.text === "?"
      ? "yellow"
      : undefined;
  const input = {
    id: id ?? row.id,
    slot,
    marker,
    title: displayTitle,
    agent: row.agent?.harness ?? "-",
    activity: activity.text,
    activityImportance: activity.importance,
    metadataGroups: metadataGroups(row),
  };
  return color === undefined
    ? worktreeStyleRowGridInput(input)
    : worktreeStyleRowGridInput({
        ...input,
        color,
      });
}

export function worktreeStyleRowGridInput(input: {
  id: string;
  slot: string | undefined;
  marker: RowMarker;
  title: string;
  agent?: string;
  activity?: string;
  activityImportance?: RowGridCellImportance;
  activityOverflow?: RowGridCell["overflow"];
  color?: RowColor;
  metadataGroups?: WorktreeRowMetadataGroups;
}): RowGridRowInput {
  const cells: Partial<Record<RowGridCellKey, RowGridCell>> = {};
  cells.identity = {
    key: "identity",
    segments: identitySegments(input.slot, input.marker, input.color),
    importance: "required",
  };
  cells.title = {
    key: "title",
    segments: [textSegment(input.title, { color: input.color })],
    importance: "required",
  };
  if (input.agent !== undefined) {
    cells.agent = {
      key: "agent",
      segments: [textSegment(input.agent, { color: input.color })],
      importance: "optional",
    };
  }
  if (input.activity !== undefined) {
    cells.activity = {
      key: "activity",
      segments: [textSegment(input.activity, { color: input.color })],
      importance: input.activityImportance ?? "optional",
    };
    if (input.activityOverflow !== undefined) {
      cells.activity.overflow = input.activityOverflow;
    }
  }
  if (input.metadataGroups !== undefined) {
    const metadata = metadataCellSegments(input.metadataGroups);
    if (metadata.length > 0) {
      cells.metadata = {
        key: "metadata",
        segments: metadata,
        importance: "optional",
      };
    }
  }

  const row: RowGridRowInput = {
    id: input.id,
    cells,
  };
  if (input.metadataGroups !== undefined) {
    row.metadataGroups = input.metadataGroups;
  }
  if (input.color !== undefined) {
    row.color = input.color;
  }
  return row;
}

export function WorktreeRowLayoutView({ layout }: { layout: RowGridLayout }) {
  return (
    <Box flexShrink={0}>
      <Segments segments={layout.segments} />
    </Box>
  );
}

function identitySegments(
  slot: string | undefined,
  marker: RowMarker,
  color: RowColor | undefined,
): RowSegment[] {
  const segments: RowSegment[] = [textSegment(` [${slot ?? " "}] `, { color })];
  if (marker.kind === "throbber") {
    segments.push({ kind: "throbber", variant: marker.variant });
  } else {
    segments.push(textSegment(marker.text, { color }));
  }
  segments.push(textSegment(" ", { color }));
  return segments;
}

function activityCellForRow(row: WorktreeRowModel): {
  text: string;
  importance: RowGridCellImportance;
} {
  if (row.display.alert || row.display.warning === true) {
    return {
      text: row.display.reason ?? row.display.statusLabel,
      importance: "meaningful",
    };
  }
  return {
    text: row.display.statusLabel,
    importance: "optional",
  };
}

function statusMarker(row: WorktreeRowModel): RowMarker {
  const state = row.agent?.state ?? "none";
  if (state === "needs_attention" || state === "stuck") return { kind: "text", text: "!" };
  if (state === "working") return { kind: "throbber", variant: "circle" };
  if (state === "idle") return { kind: "text", text: "○" };
  if (state === "starting") return { kind: "text", text: "+" };
  if (state === "unknown") return { kind: "text", text: "?" };
  if (state === "exited") return { kind: "text", text: "x" };
  return { kind: "text", text: "-" };
}

type MetadataSegment = {
  text: string;
  stale: boolean;
  color?: MetadataColor;
  underline?: true;
  url?: string;
};

type MetadataColor = "green" | "red" | "blue" | "yellow" | "gray";

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

export function metadataSegments(row: WorktreeRowModel): MetadataSegment[] {
  const segments: MetadataSegment[] = [];
  const { changeSummary, pr, checks } = row.worktree;
  if (changeSummary !== undefined && (changeSummary.additions > 0 || changeSummary.deletions > 0)) {
    if (changeSummary.additions > 0) {
      segments.push({
        text: `+${changeSummary.additions}`,
        stale: changeSummary.stale === true,
        color: "green",
      });
    }
    if (changeSummary.deletions > 0) {
      segments.push({
        text: `-${changeSummary.deletions}`,
        stale: changeSummary.stale === true,
        color: "red",
      });
    }
  }
  if (pr === undefined) {
    return segments;
  }
  segments.push({
    text: `#${pr.number}`,
    stale: pr.stale === true,
    color: "blue",
    underline: true,
    ...(pr.url === undefined ? {} : { url: pr.url }),
  });
  if (checks !== undefined) {
    segments.push({
      text: checksStateGlyph(checks),
      stale: checks.stale === true,
      color: checksStateColor(checks),
    });
  }
  return segments;
}

function metadataGroups(row: WorktreeRowModel): WorktreeRowMetadataGroups {
  const segments = metadataSegments(row).map(rowSegmentFromMetadata);
  const diffCount = diffMetadataSegmentCount(row);
  return {
    diff: segments.slice(0, diffCount),
    pr: segments.slice(diffCount),
  };
}

function metadataCellSegments(groups: WorktreeRowMetadataGroups): RowSegment[] {
  const segments: RowSegment[] = [];
  [...groups.diff, ...groups.pr].forEach((segment, index) => {
    if (index > 0) {
      segments.push(textSegment(" "));
    }
    segments.push(segment);
  });
  return segments;
}

function rowSegmentFromMetadata(segment: MetadataSegment): RowSegment {
  return textSegment(segment.text, {
    color: segment.color,
    dimColor: segment.stale ? true : undefined,
    underline: segment.underline,
    url: segment.url,
  });
}

function diffMetadataSegmentCount(row: WorktreeRowModel): number {
  const { changeSummary } = row.worktree;
  if (changeSummary === undefined) {
    return 0;
  }
  let count = 0;
  if (changeSummary.additions > 0) count += 1;
  if (changeSummary.deletions > 0) count += 1;
  return count;
}

function checksStateGlyph(checks: NonNullable<WorktreeRowModel["worktree"]["checks"]>) {
  if (checks.state === "pass") return "✓";
  if (checks.state === "fail") return failedChecksGlyph(checks.failed);
  if (checks.state === "cancelled") return failedChecksGlyph(checks.cancelled);
  if (checks.state === "running") return "…";
  return "-";
}

function checksStateColor(
  checks: NonNullable<WorktreeRowModel["worktree"]["checks"]>,
): MetadataColor {
  if (checks.state === "pass") return "green";
  if (checks.state === "fail" || checks.state === "cancelled") return "red";
  if (checks.state === "running") return "yellow";
  return "gray";
}

function failedChecksGlyph(count: number | undefined): string {
  return count === undefined || count <= 0 ? "x" : `x${count}`;
}
