import type { WorktreeRow as WorktreeRowModel } from "@wosm/contracts";
import { Box, Text } from "ink";
import { Link } from "../Link/Link.js";
import { Throbber, type ThrobberVariant } from "../Throbber/Throbber.js";

export type WorktreeRowProps = {
  row: WorktreeRowModel;
  slot: string | undefined;
  title?: string;
};

export function WorktreeRow({ row, slot, title }: WorktreeRowProps) {
  const marker = statusMarker(row);
  const displayTitle = title ?? row.branch;
  const harness = row.agent?.harness ?? "-";
  const metadata = metadataSegments(row);
  const warningReason =
    row.display.warning === true && row.display.reason !== undefined
      ? row.display.reason
      : undefined;
  const color = row.display.alert
    ? "red"
    : marker.kind === "text" && marker.glyph === "?"
      ? "yellow"
      : undefined;
  const suffix = warningReason === undefined ? `  ${harness}` : `  ${harness}  ${warningReason}`;
  return (
    <Box width="100%" justifyContent="space-between">
      <Box flexShrink={1}>
        <ColoredText color={color}>{` [${slot ?? " "}] `}</ColoredText>
        {marker.kind === "throbber" ? (
          <Throbber variant={marker.variant} />
        ) : (
          <ColoredText color={color}>{marker.glyph}</ColoredText>
        )}
        <ColoredText color={color}>{` ${displayTitle}`}</ColoredText>
        <ColoredText color={color}>{suffix}</ColoredText>
      </Box>
      {metadata.length > 0 ? (
        <Box flexShrink={0}>
          {metadata.map((segment, index) => (
            <MetadataText key={segment.text} segment={segment} color={color} first={index === 0} />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

type StatusMarker =
  | {
      kind: "text";
      glyph: string;
    }
  | {
      kind: "throbber";
      variant: Extract<ThrobberVariant, "circle">;
    };

function statusMarker(row: WorktreeRowModel): StatusMarker {
  const state = row.agent?.state ?? "none";
  if (state === "needs_attention" || state === "stuck") return { kind: "text", glyph: "!" };
  if (state === "working") return { kind: "throbber", variant: "circle" };
  if (state === "idle") return { kind: "text", glyph: "○" };
  if (state === "starting") return { kind: "text", glyph: "+" };
  if (state === "unknown") return { kind: "text", glyph: "?" };
  if (state === "exited") return { kind: "text", glyph: "x" };
  return { kind: "text", glyph: "-" };
}

type MetadataSegment = {
  text: string;
  stale: boolean;
  color?: MetadataColor;
  underline?: true;
  url?: string;
};

type MetadataColor = "green" | "red" | "blue" | "yellow" | "gray";

function ColoredText({
  children,
  color,
}: {
  children: string;
  color: "red" | "yellow" | undefined;
}) {
  return color === undefined ? <Text>{children}</Text> : <Text color={color}>{children}</Text>;
}

function MetadataText({
  segment,
  color,
  first,
}: {
  segment: MetadataSegment;
  color: "red" | "yellow" | undefined;
  first: boolean;
}) {
  const textColor = segment.color ?? color;
  const props: {
    dimColor: boolean;
    underline: boolean;
    color?: MetadataColor | "red" | "yellow";
  } = {
    dimColor: segment.stale,
    underline: segment.underline === true,
  };
  if (textColor !== undefined) {
    props.color = textColor;
  }
  const rendered = <Text {...props}>{segment.text}</Text>;
  const url = segment.url;
  const body = url === undefined ? rendered : <Link url={url}>{rendered}</Link>;
  return (
    <>
      {first ? null : <Text> </Text>}
      {body}
    </>
  );
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
