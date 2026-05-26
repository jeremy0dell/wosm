import type { WosmSnapshot } from "@wosm/contracts";
import { Box, Text } from "ink";
import { selectKeySlots, selectProjectGroups } from "../selectors.js";
import { useTuiMode } from "../tuiMode.js";
import type { TuiUiState } from "../uiState.js";
import { ProjectGroup } from "./ProjectGroup.js";

export type DashboardProps = {
  snapshot: WosmSnapshot;
  uiState: TuiUiState;
  quitActionLabel?: "close" | "quit";
};

export function Dashboard({ snapshot, uiState, quitActionLabel = "quit" }: DashboardProps) {
  const groups = selectProjectGroups(snapshot, uiState);
  const slots = selectKeySlots(snapshot, uiState);
  const quitHint = quitActionLabel === "close" ? "q/esc:close" : "q:quit";
  const mode = useTuiMode();
  const productLabel = mode === "dev" ? "wosm dev" : "wosm";
  return (
    <Box flexDirection="column">
      <Text bold>
        {productLabel} {snapshot.counts.projects} projects | {snapshot.counts.worktrees} worktrees |{" "}
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
        <Text color="gray">n:new bg 1-9:start/focus x:remove /:search r:refresh {quitHint}</Text>
      </Box>
    </Box>
  );
}
