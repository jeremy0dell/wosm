import type { WosmSnapshot } from "@wosm/contracts";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import {
  type DashboardViewportItem,
  selectDashboardViewport,
} from "../../selectors/dashboardViewport.js";
import type { KeyedChoice } from "../../selectors/selectors.js";
import type { TuiScreen, TuiViewState } from "../../state/types.js";
import { useTuiMode } from "../../tuiMode.js";
import type { TopRowWidgetView } from "../../widgets/types.js";
import { layoutWorktreeRowGrid, type RowGridLayout, truncateCells } from "../WorktreeRow/layout.js";
import { WorktreeRowLayoutView } from "../WorktreeRow/WorktreeRow.js";
import {
  type DashboardHeaderStatus,
  dashboardFooterLabel,
  dashboardHeaderLine,
  emptyProjectLabel,
  FIRST_RUN_BODY_LABEL,
  projectHeaderLabel,
  rowGridInputForViewportItem,
  scrollIndicatorLabel,
} from "./content.js";

export type DashboardProps = {
  snapshot: WosmSnapshot;
  screen?: TuiScreen;
  viewState: TuiViewState;
  quitActionLabel?: "close" | "quit";
  columns?: number;
  topRowWidgets?: readonly TopRowWidgetView[];
  observerStatus?: DashboardHeaderStatus;
};

export function Dashboard({
  snapshot,
  viewState,
  quitActionLabel = "quit",
  columns = 80,
  topRowWidgets = [],
  observerStatus,
}: DashboardProps) {
  const viewport = selectDashboardViewport(snapshot, viewState);
  const quitHint = quitActionLabel === "close" ? "Q/esc:close" : "Q:quit";
  const mode = useTuiMode();
  const productLabel = mode === "dev" ? "wosm dev" : "wosm";
  const contentColumns = Math.max(1, Math.floor(columns) - 1);
  return (
    <DashboardLayout>
      <DashboardHeader
        productLabel={productLabel}
        columns={contentColumns}
        widgets={topRowWidgets}
        {...(observerStatus === undefined ? {} : { status: observerStatus })}
      />
      <DashboardDivider columns={contentColumns} />
      <ScrollIndicatorRow direction="above" hiddenCount={viewport.hiddenAbove} />
      {snapshot.projects.length === 0 ? (
        <FirstRunBody columns={contentColumns} />
      ) : (
        <DashboardBody
          columns={contentColumns}
          items={viewport.visibleItems}
          choices={viewport.displayRowChoices}
        />
      )}
      <ScrollIndicatorRow direction="below" hiddenCount={viewport.hiddenBelow} />
      <DashboardDivider columns={contentColumns} />
      <DashboardFooter
        columns={contentColumns}
        quitHint={quitHint}
        firstRun={snapshot.projects.length === 0}
      />
    </DashboardLayout>
  );
}

function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Box flexDirection="column" height="100%" overflow="hidden" paddingRight={1}>
      {children}
    </Box>
  );
}

export function DashboardHeader({
  productLabel,
  columns,
  status,
  widgets,
}: {
  productLabel: string;
  columns: number;
  status?: DashboardHeaderStatus;
  widgets: readonly TopRowWidgetView[];
}) {
  const headerLine = dashboardHeaderLine({
    productLabel,
    columns,
    widgets,
    ...(status === undefined ? {} : { status }),
  });
  const suffix = headerLine.startsWith(productLabel) ? headerLine.slice(productLabel.length) : "";
  return (
    <Box flexShrink={0}>
      <Text wrap="truncate-end">
        <Text bold>{productLabel}</Text>
        {suffix}
      </Text>
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
  return (
    <Box flexShrink={0} height={1}>
      {hiddenCount > 0 ? (
        <Text color="gray">{scrollIndicatorLabel(direction, hiddenCount)}</Text>
      ) : null}
    </Box>
  );
}

function FirstRunBody({ columns }: { columns: number }) {
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} overflowY="hidden">
      <Text>{truncateCells(FIRST_RUN_BODY_LABEL, columns)}</Text>
    </Box>
  );
}

function DashboardBody({
  columns,
  items,
  choices,
}: {
  columns: number;
  items: readonly DashboardViewportItem[];
  choices: ReadonlyArray<KeyedChoice<DashboardViewportWorktree>>;
}) {
  const keyByRow = new Map(choices.map((choice) => [choice.value.id, choice.key]));
  const rowInputs = items.flatMap((item) => {
    const input = rowGridInputForViewportItem(item, keyByRow);
    return input === undefined ? [] : [input];
  });
  const rowLayouts = layoutWorktreeRowGrid({ columns, rows: rowInputs });
  const layoutByItem = new Map(rowLayouts.map((layout) => [layout.id, layout]));
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} overflowY="hidden">
      {items.map((item) => (
        <DashboardViewportRow
          key={item.id}
          columns={columns}
          item={item}
          layout={layoutByItem.get(item.id)}
        />
      ))}
    </Box>
  );
}

type DashboardViewportWorktree = Extract<DashboardViewportItem, { type: "worktree" }>["row"];

function DashboardViewportRow({
  columns,
  item,
  layout,
}: {
  columns: number;
  item: DashboardViewportItem;
  layout: RowGridLayout | undefined;
}) {
  switch (item.type) {
    case "projectGap":
      return <Box height={1} />;
    case "projectHeader":
      return (
        <ProjectHeaderRow columns={columns} project={item.project} collapsed={item.collapsed} />
      );
    case "emptyProject":
      return <EmptyProjectRow columns={columns} project={item.project} />;
    case "worktree":
      return layout === undefined ? null : <WorktreeRowLayoutView layout={layout} />;
    case "createLocalRow":
      return layout === undefined ? null : <WorktreeRowLayoutView layout={layout} />;
  }
}

function ProjectHeaderRow({
  columns,
  project,
  collapsed,
}: {
  columns: number;
  project: Extract<DashboardViewportItem, { type: "projectHeader" }>["project"];
  collapsed: boolean;
}) {
  return <Text bold>{truncateCells(projectHeaderLabel(project, collapsed), columns)}</Text>;
}

function EmptyProjectRow({
  columns,
  project,
}: {
  columns: number;
  project: Extract<DashboardViewportItem, { type: "emptyProject" }>["project"];
}) {
  return <Text color="gray">{truncateCells(emptyProjectLabel(project), columns)}</Text>;
}

function DashboardFooter({
  columns,
  quitHint,
  firstRun = false,
}: {
  columns: number;
  quitHint: string;
  firstRun?: boolean;
}) {
  const label = dashboardFooterLabel({ columns, quitHint, firstRun });
  return (
    <Box flexShrink={0}>
      <Text wrap="truncate-end">{label}</Text>
    </Box>
  );
}
