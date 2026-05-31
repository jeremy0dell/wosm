import type { ProjectView, WorktreeRow } from "@wosm/contracts";
import { Box, Text } from "ink";
import type { KeyedChoice } from "../../selectors/selectors.js";
import { WorktreeRow as WorktreeRowView } from "../WorktreeRow/WorktreeRow.js";

export type ProjectGroupProps = {
  project: ProjectView;
  rows: readonly WorktreeRow[];
  collapsed: boolean;
  choices: ReadonlyArray<KeyedChoice<WorktreeRow>>;
};

export function ProjectGroup({ project, rows, collapsed, choices }: ProjectGroupProps) {
  const keyByRow = new Map(choices.map((choice) => [choice.value.id, choice.key]));
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        {collapsed ? "▶" : "▼"} {project.label} - {project.counts.worktrees} worktrees |{" "}
        {project.defaults.harness}
      </Text>
      {!collapsed && rows.length === 0 ? <Text color="gray"> 0 worktrees</Text> : null}
      {collapsed
        ? null
        : rows.map((row) => <WorktreeRowView key={row.id} row={row} slot={keyByRow.get(row.id)} />)}
    </Box>
  );
}
