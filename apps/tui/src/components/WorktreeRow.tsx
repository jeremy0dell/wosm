import type { WorktreeRow as WorktreeRowModel } from "@wosm/contracts";
import { Box, Text } from "ink";

export type WorktreeRowProps = {
  row: WorktreeRowModel;
  slot: string | undefined;
  selected: boolean;
};

export function WorktreeRow({ row, slot, selected }: WorktreeRowProps) {
  const marker = row.display.alert ? "!" : selected ? ">" : ".";
  const harness = row.agent?.harness ?? "-";
  const terminal = row.terminal?.provider ?? "-";
  const reason =
    row.display.warning === true && row.display.reason !== undefined
      ? ` ${row.display.reason}`
      : "";
  const line = `[${slot ?? " "}] ${marker} ${row.branch}  ${harness}  ${row.display.statusLabel}  ${terminal}${reason}`;
  const color = row.display.alert ? "red" : selected ? "cyan" : undefined;
  return <Box>{color === undefined ? <Text>{line}</Text> : <Text color={color}>{line}</Text>}</Box>;
}
