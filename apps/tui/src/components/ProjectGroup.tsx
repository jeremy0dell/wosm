import type { ProjectView, WorktreeRow } from "@wosm/contracts";
import { Box, Text } from "ink";
import { WorktreeRow as WorktreeRowView } from "./WorktreeRow.js";

export type ProjectGroupProps = {
  project: ProjectView;
  rows: readonly WorktreeRow[];
  collapsed: boolean;
  slots: ReadonlyMap<string, WorktreeRow>;
};

export function ProjectGroup({ project, rows, slots }: ProjectGroupProps) {
  const slotByRow = new Map([...slots.entries()].map(([slot, row]) => [row.id, slot]));
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        ▼ {project.label} - {project.counts.worktrees} worktrees | {project.defaults.harness}
      </Text>
      {rows.length === 0 ? <Text color="gray"> 0 worktrees</Text> : null}
      {rows.map((row) => (
        <WorktreeRowView key={row.id} row={row} slot={slotByRow.get(row.id)} />
      ))}
    </Box>
  );
}
