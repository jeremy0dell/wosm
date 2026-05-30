import type { WorktreeRow as WorktreeRowModel } from "@wosm/contracts";
import { Box, Text } from "ink";
import { Throbber, type ThrobberVariant } from "../Throbber/Throbber.js";

export type WorktreeRowProps = {
  row: WorktreeRowModel;
  slot: string | undefined;
};

export function WorktreeRow({ row, slot }: WorktreeRowProps) {
  const marker = statusMarker(row);
  const harness = row.agent?.harness ?? "-";
  const metadata = metadataSegments(row);
  const reason =
    row.display.warning === true && row.display.reason !== undefined
      ? ` ${row.display.reason}`
      : "";
  const color = row.display.alert
    ? "red"
    : marker.kind === "text" && marker.glyph === "?"
      ? "yellow"
      : undefined;
  const suffix = `  ${harness}  ${row.display.statusLabel}${reason}`;
  return (
    <Box>
      <ColoredText color={color}>{` [${slot ?? " "}] `}</ColoredText>
      {marker.kind === "throbber" ? (
        <Throbber variant={marker.variant} />
      ) : (
        <ColoredText color={color}>{marker.glyph}</ColoredText>
      )}
      <ColoredText color={color}>{` ${row.branch}`}</ColoredText>
      {metadata.map((segment) => (
        <MetadataText key={segment.text} segment={segment} color={color} />
      ))}
      <ColoredText color={color}>{suffix}</ColoredText>
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
};

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
}: {
  segment: MetadataSegment;
  color: "red" | "yellow" | undefined;
}) {
  const text = `  ${segment.text}`;
  if (segment.stale) return <Text dimColor>{text}</Text>;
  return color === undefined ? <Text>{text}</Text> : <Text color={color}>{text}</Text>;
}

export function metadataSegments(row: WorktreeRowModel): MetadataSegment[] {
  const segments: MetadataSegment[] = [];
  const { changeSummary, pr, checks } = row.worktree;
  if (changeSummary !== undefined) {
    segments.push({
      text: `+${changeSummary.additions}/-${changeSummary.deletions}`,
      stale: changeSummary.stale === true,
    });
  }
  if (pr === undefined) {
    return segments;
  }
  segments.push({
    text: pr.url === undefined ? `#${pr.number}` : osc8(pr.url, `#${pr.number}`),
    stale: pr.stale === true,
  });
  if (checks !== undefined) {
    segments.push({
      text: checksStateGlyph(checks),
      stale: checks.stale === true,
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

function failedChecksGlyph(count: number | undefined): string {
  return count === undefined || count <= 0 ? "x" : `x${count}`;
}

function osc8(url: string, text: string): string {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}
