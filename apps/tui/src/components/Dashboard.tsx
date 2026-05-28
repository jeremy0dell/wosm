import type { WosmSnapshot } from "@wosm/contracts";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { selectKeySlots, selectProjectGroups } from "../selectors.js";
import { useTuiMode } from "../tuiMode.js";
import type { TuiUiState } from "../uiState.js";
import { ProjectGroup } from "./ProjectGroup.js";

export type DashboardProps = {
  snapshot: WosmSnapshot;
  uiState: TuiUiState;
  quitActionLabel?: "close" | "quit";
  columns?: number;
  children?: ReactNode;
};

export function Dashboard({
  snapshot,
  uiState,
  quitActionLabel = "quit",
  columns = 80,
  children,
}: DashboardProps) {
  const renderState = expandedRenderState(uiState);
  const groups = selectProjectGroups(snapshot, renderState);
  const slots = selectKeySlots(snapshot, renderState);
  const quitHint = quitActionLabel === "close" ? "q/esc:close" : "q:quit";
  const mode = useTuiMode();
  const productLabel = mode === "dev" ? "wosm dev" : "wosm";
  return (
    <DashboardLayout>
      <DashboardHeader productLabel={productLabel} />
      <DashboardDivider columns={columns} />
      <ReservedIndicatorRow />
      <DashboardBody groups={groups} slots={slots}>
        {children}
      </DashboardBody>
      <ReservedIndicatorRow />
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

function ReservedIndicatorRow() {
  return <Box flexShrink={0} height={1} />;
}

function DashboardBody({
  groups,
  slots,
  children,
}: {
  groups: ReturnType<typeof selectProjectGroups>;
  slots: ReturnType<typeof selectKeySlots>;
  children: ReactNode;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} overflowY="hidden">
      {groups.map((group) => (
        <ProjectGroup
          key={group.project.id}
          project={group.project}
          rows={group.rows}
          collapsed={false}
          slots={slots}
        />
      ))}
      {children}
    </Box>
  );
}

function DashboardFooter({ quitHint }: { quitHint: string }) {
  return (
    <Box flexShrink={0}>
      <Text color="gray">N:new 1-9:start/focus X:remove /:search R:refresh H:help {quitHint}</Text>
    </Box>
  );
}

function expandedRenderState(uiState: TuiUiState): TuiUiState {
  const renderState: TuiUiState = {
    searchQuery: uiState.searchQuery,
    collapsedProjectIds: new Set(),
  };
  if (uiState.prompt !== undefined) {
    renderState.prompt = uiState.prompt;
  }
  return renderState;
}
