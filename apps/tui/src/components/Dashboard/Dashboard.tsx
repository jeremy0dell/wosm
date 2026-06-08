import type { ProjectView, WosmSnapshot } from "@wosm/contracts";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import stringWidth from "string-width";
import {
  type DashboardViewportItem,
  selectDashboardViewport,
} from "../../selectors/dashboardViewport.js";
import type { KeyedChoice } from "../../selectors/selectors.js";
import type { TuiScreen, TuiViewState } from "../../state/screen.js";
import { useTuiMode } from "../../tuiMode.js";
import type { TopRowWidgetView } from "../../widgets/types.js";
import {
  layoutWorktreeRowGrid,
  type RowGridLayout,
  type RowGridRowInput,
  truncateCells,
} from "../WorktreeRow/layout.js";
import {
  WorktreeRowLayoutView,
  worktreeRowGridInput,
  worktreeStyleRowGridInput,
} from "../WorktreeRow/WorktreeRow.js";

export type DashboardProps = {
  snapshot: WosmSnapshot;
  screen?: TuiScreen;
  viewState: TuiViewState;
  quitActionLabel?: "close" | "quit";
  columns?: number;
  topRowWidgets?: readonly TopRowWidgetView[];
};

export function Dashboard({
  snapshot,
  viewState,
  quitActionLabel = "quit",
  columns = 80,
  topRowWidgets = [],
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
  widgets,
}: {
  productLabel: string;
  columns: number;
  widgets: readonly TopRowWidgetView[];
}) {
  const headerLine = dashboardHeaderLine({ productLabel, columns, widgets });
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

export function dashboardHeaderLine({
  productLabel,
  columns,
  widgets,
}: {
  productLabel: string;
  columns: number;
  widgets: readonly TopRowWidgetView[];
}): string {
  const safeColumns = Math.max(1, columns);
  const productWidth = stringWidth(productLabel);
  if (widgets.length === 0 || productWidth >= safeColumns) {
    return productLabel;
  }

  for (let visibleCount = widgets.length; visibleCount > 0; visibleCount -= 1) {
    const strip = widgets
      .slice(0, visibleCount)
      .map((widget) => widget.text)
      .join("  ");
    const stripWidth = stringWidth(strip);
    const gapWidth = safeColumns - productWidth - stripWidth;
    if (gapWidth >= 1) {
      return `${productLabel}${" ".repeat(gapWidth)}${strip}`;
    }
  }

  return productLabel;
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

function FirstRunBody({ columns }: { columns: number }) {
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} overflowY="hidden">
      <Text>{truncateCells("No projects configured yet.", columns)}</Text>
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

function rowGridInputForViewportItem(
  item: DashboardViewportItem,
  keyByRow: ReadonlyMap<string, string>,
): RowGridRowInput | undefined {
  if (item.type === "worktree") {
    if (item.pendingRemove !== undefined) {
      return worktreeStyleRowGridInput({
        id: item.id,
        slot: undefined,
        marker: { kind: "throbber", variant: "braille" },
        title: item.displayTitle,
        activity: "removing worktree...",
        activityImportance: "meaningful",
        activityOverflow: "rowSlack",
      });
    }
    if (item.pendingStart !== undefined) {
      return worktreeStyleRowGridInput({
        id: item.id,
        slot: keyByRow.get(item.row.id),
        marker: { kind: "throbber", variant: "braille" },
        title: item.displayTitle,
        activity: "starting...",
        activityImportance: "meaningful",
        activityOverflow: "rowSlack",
      });
    }
    return worktreeRowGridInput({
      id: item.id,
      row: item.row,
      slot: keyByRow.get(item.row.id),
      title: item.displayTitle,
    });
  }
  if (item.type !== "createLocalRow") {
    return undefined;
  }
  if (item.row.status === "failed") {
    return worktreeStyleRowGridInput({
      id: item.id,
      slot: undefined,
      marker: { kind: "text", text: "!" },
      title: item.row.branch,
      activity: item.row.error.message,
      activityImportance: "meaningful",
      activityOverflow: "rowSlack",
      color: "red",
    });
  }
  return worktreeStyleRowGridInput({
    id: item.id,
    slot: undefined,
    marker: { kind: "throbber", variant: "braille" },
    title: item.row.branch,
    agent: item.row.harnessProvider,
    activity: "starting session...",
    activityImportance: "meaningful",
    activityOverflow: "rowSlack",
  });
}

function ProjectHeaderRow({
  columns,
  project,
  collapsed,
}: {
  columns: number;
  project: ProjectView;
  collapsed: boolean;
}) {
  const label = `${collapsed ? "▶" : "▼"} ${project.label} - ${
    project.counts.worktrees
  } worktrees | ${project.defaults.harness}`;
  return <Text bold>{truncateCells(label, columns)}</Text>;
}

function EmptyProjectRow({ columns, project }: { columns: number; project: ProjectView }) {
  return (
    <Text color="gray">{truncateCells(` ${project.counts.worktrees} worktrees`, columns)}</Text>
  );
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
  const full = firstRun
    ? `A:Add Project S:setup ${quitHint}`
    : `N:new A:add R:rename Z:refresh 1-9/a-z:open X:rm /:search C:fold H:help ${quitHint}`;
  const compactClose = `Q/esc:close N:new A:add Z:refresh 1-9/a-z:open X:remove /:search H:help`;
  const label = quitHint === "Q/esc:close" && full.length > columns ? compactClose : full;
  return (
    <Box flexShrink={0}>
      <Text wrap="truncate-end">{label}</Text>
    </Box>
  );
}
