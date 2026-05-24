import type { WosmSnapshot } from "@wosm/contracts";
import { Box, Text } from "ink";
import { selectKeySlots, selectProjectGroups } from "../selectors.js";
import type { TuiUiState } from "../uiState.js";
import { ProjectGroup } from "./ProjectGroup.js";

export type DashboardProps = {
  snapshot: WosmSnapshot;
  uiState: TuiUiState;
};

export function Dashboard({ snapshot, uiState }: DashboardProps) {
  const groups = selectProjectGroups(snapshot, uiState);
  const slots = selectKeySlots(snapshot, uiState);
  return (
    <Box flexDirection="column">
      <Text bold>
        wosm {snapshot.counts.projects} projects | {snapshot.counts.worktrees} worktrees |{" "}
        {snapshot.counts.working} working | {snapshot.counts.attention} attention
      </Text>
      {groups.map((group) => (
        <ProjectGroup
          key={group.project.id}
          project={group.project}
          rows={group.rows}
          collapsed={group.collapsed}
          slots={slots}
        />
      ))}
      <Box marginTop={1}>
        <Text color="gray">n:new bg 1-9:start/focus /:search r:refresh q:quit</Text>
      </Box>
    </Box>
  );
}
