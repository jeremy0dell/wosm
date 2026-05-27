import type { WorktreeRow as WorktreeRowModel } from "@wosm/contracts";
import { Box, Text } from "ink";

export type WorktreeRowProps = {
  row: WorktreeRowModel;
  slot: string | undefined;
};

export function WorktreeRow({ row, slot }: WorktreeRowProps) {
  const marker = statusMarker(row);
  const harness = row.agent?.harness ?? "-";
  const terminal = row.terminal?.provider ?? "-";
  const metadata = metadataSegments(row);
  const reason =
    row.display.warning === true && row.display.reason !== undefined
      ? ` ${row.display.reason}`
      : "";
  const color = row.display.alert ? "red" : marker === "?" ? "yellow" : undefined;
  const prefix = `[${slot ?? " "}] ${marker} ${row.branch}`;
  const suffix = `  ${harness}  ${row.display.statusLabel}  ${terminal}${reason}`;
  return (
    <Box>
      {color === undefined ? <Text>{prefix}</Text> : <Text color={color}>{prefix}</Text>}
      {metadata.map((segment) => (
        <MetadataText key={segment.text} segment={segment} color={color} />
      ))}
      {color === undefined ? <Text>{suffix}</Text> : <Text color={color}>{suffix}</Text>}
    </Box>
  );
}

function statusMarker(row: WorktreeRowModel): string {
  const state = row.agent?.state ?? "none";
  if (state === "needs_attention" || state === "stuck") return "!";
  if (state === "working") return "*";
  if (state === "idle") return ".";
  if (state === "starting") return "+";
  if (state === "unknown") return "?";
  if (state === "exited") return "x";
  return "-";
}

type MetadataSegment = {
  text: string;
  stale: boolean;
};

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
  if (pr !== undefined) {
    segments.push({
      text: pr.url === undefined ? `#${pr.number}` : osc8(pr.url, `#${pr.number}`),
      stale: pr.stale === true,
    });
  }
  if (checks !== undefined) {
    segments.push({
      text: `ci:${checksStateLabel(checks.state)}`,
      stale: checks.stale === true,
    });
  }
  return segments;
}

function checksStateLabel(state: NonNullable<WorktreeRowModel["worktree"]["checks"]>["state"]) {
  if (state === "running") return "run";
  if (state === "skipped") return "skip";
  if (state === "cancelled") return "cancel";
  if (state === "unknown") return "?";
  return state;
}

function osc8(url: string, text: string): string {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}
