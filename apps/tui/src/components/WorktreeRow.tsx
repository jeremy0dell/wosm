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
  const reason =
    row.display.warning === true && row.display.reason !== undefined
      ? ` ${row.display.reason}`
      : "";
  const line = `[${slot ?? " "}] ${marker} ${row.branch}  ${harness}  ${row.display.statusLabel}  ${terminal}${reason}`;
  const color = row.display.alert ? "red" : marker === "?" ? "yellow" : undefined;
  return <Box>{color === undefined ? <Text>{line}</Text> : <Text color={color}>{line}</Text>}</Box>;
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
