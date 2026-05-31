import type { ProjectView, WosmSnapshot } from "@wosm/contracts";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import {
  type DashboardViewportItem,
  selectDashboardViewport,
} from "../../selectors/dashboardViewport.js";
import type { KeyedChoice } from "../../selectors/selectors.js";
import type { TuiScreen, TuiViewState } from "../../state/screen.js";
import { useTuiMode } from "../../tuiMode.js";
import { WorktreeRow } from "../WorktreeRow/WorktreeRow.js";

export type DashboardProps = {
  snapshot: WosmSnapshot;
  screen?: TuiScreen;
  viewState: TuiViewState;
  quitActionLabel?: "close" | "quit";
  columns?: number;
};

export function Dashboard({
  snapshot,
  viewState,
  quitActionLabel = "quit",
  columns = 80,
}: DashboardProps) {
  const viewport = selectDashboardViewport(snapshot, viewState);
  const quitHint = quitActionLabel === "close" ? "Q/esc:close" : "Q:quit";
  const mode = useTuiMode();
  const productLabel = mode === "dev" ? "wosm dev" : "wosm";
  return (
    <DashboardLayout>
      <DashboardHeader productLabel={productLabel} />
      <DashboardDivider columns={columns} />
      <ScrollIndicatorRow direction="above" hiddenCount={viewport.hiddenAbove} />
      <DashboardBody items={viewport.visibleItems} choices={viewport.rowChoices} />
      <ScrollIndicatorRow direction="below" hiddenCount={viewport.hiddenBelow} />
      <DashboardDivider columns={columns} />
      <DashboardFooter quitHint={quitHint} />
    </DashboardLayout>
  );
}

function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Box flexDirection="column" height="100%" overflow="hidden">
      {children}
    </Box>
  );
}

function DashboardHeader({ productLabel }: { productLabel: string }) {
  return (
    <Box flexShrink={0}>
      <Text bold>{productLabel}</Text>
    </Box>
  );
}

function DashboardDivider({ columns }: { columns: number }) {
  return (
    <Box flexShrink={0}>
      <Text color="gray">{"─".repeat(Math.max(1, columns))}</Text>
    </Box>
  );
}

function ScrollIndicatorRow({
  direction,
  hiddenCount,
}: {
  direction: "above" | "below";
  hiddenCount: number;
}) {
  const marker = direction === "above" ? "↑" : "↓";
  return (
    <Box flexShrink={0} height={1}>
      {hiddenCount > 0 ? <Text color="gray">{`${marker} ${hiddenCount} hidden`}</Text> : null}
    </Box>
  );
}

function DashboardBody({
  items,
  choices,
}: {
  items: readonly DashboardViewportItem[];
  choices: ReadonlyArray<KeyedChoice<DashboardViewportWorktree>>;
}) {
  const keyByRow = new Map(choices.map((choice) => [choice.value.id, choice.key]));
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} overflowY="hidden">
      {items.map((item) => (
        <DashboardViewportRow key={item.id} item={item} keyByRow={keyByRow} />
      ))}
    </Box>
  );
}

type DashboardViewportWorktree = Extract<DashboardViewportItem, { type: "worktree" }>["row"];

function DashboardViewportRow({
  item,
  keyByRow,
}: {
  item: DashboardViewportItem;
  keyByRow: ReadonlyMap<string, string>;
}) {
  switch (item.type) {
    case "projectGap":
      return <Box height={1} />;
    case "projectHeader":
      return <ProjectHeaderRow project={item.project} collapsed={item.collapsed} />;
    case "emptyProject":
      return <EmptyProjectRow project={item.project} />;
    case "worktree":
      return <WorktreeRow row={item.row} slot={keyByRow.get(item.row.id)} />;
  }
}

function ProjectHeaderRow({ project, collapsed }: { project: ProjectView; collapsed: boolean }) {
  return (
    <Text bold>
      {collapsed ? "▶" : "▼"} {project.label} - {project.counts.worktrees} worktrees |{" "}
      {project.defaults.harness}
    </Text>
  );
}

function EmptyProjectRow({ project }: { project: ProjectView }) {
  return <Text color="gray"> {project.counts.worktrees} worktrees</Text>;
}

function DashboardFooter({ quitHint }: { quitHint: string }) {
  return (
    <Box flexShrink={0}>
      <Text color="gray">
        N:new 1-9/a-z:start/focus X:remove /:search R:refresh H:help {quitHint}
      </Text>
    </Box>
  );
}
