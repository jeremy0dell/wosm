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
import { Throbber } from "../Throbber/Throbber.js";
import { WorktreeRow } from "../WorktreeRow/WorktreeRow.js";

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
  const contentColumns = Math.max(1, columns - 1);
  return (
    <DashboardLayout>
      <DashboardHeader
        productLabel={productLabel}
        columns={contentColumns}
        widgets={topRowWidgets}
      />
      <DashboardDivider columns={contentColumns} />
      <ScrollIndicatorRow direction="above" hiddenCount={viewport.hiddenAbove} />
      <DashboardBody items={viewport.visibleItems} choices={viewport.displayRowChoices} />
      <ScrollIndicatorRow direction="below" hiddenCount={viewport.hiddenBelow} />
      <DashboardDivider columns={contentColumns} />
      <DashboardFooter columns={contentColumns} quitHint={quitHint} />
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
      if (item.pendingRemove !== undefined) {
        return <RemoveWorktreeLocalRow displayTitle={item.displayTitle} />;
      }
      if (item.pendingStart !== undefined) {
        return (
          <StartAgentLocalRow displayTitle={item.displayTitle} slot={keyByRow.get(item.row.id)} />
        );
      }
      return (
        <WorktreeRow row={item.row} slot={keyByRow.get(item.row.id)} title={item.displayTitle} />
      );
    case "createLocalRow":
      return <CreateSessionLocalRow row={item.row} />;
  }
}

function RemoveWorktreeLocalRow({ displayTitle }: { displayTitle: string }) {
  return (
    <Box>
      <Text>{" [ ] "}</Text>
      <Throbber variant="braille" />
      <Text>{` ${displayTitle}  removing worktree...`}</Text>
    </Box>
  );
}

function StartAgentLocalRow({
  displayTitle,
  slot,
}: {
  displayTitle: string;
  slot: string | undefined;
}) {
  return (
    <Box>
      <Text>{` [${slot ?? " "}] `}</Text>
      <Throbber variant="braille" />
      <Text>{` ${displayTitle}  starting...`}</Text>
    </Box>
  );
}

function CreateSessionLocalRow({
  row,
}: {
  row: Extract<DashboardViewportItem, { type: "createLocalRow" }>["row"];
}) {
  if (row.status === "failed") {
    return (
      <Box>
        <Text color="red">{` [ ] ! ${row.branch} - ${row.error.message}`}</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text>{" [ ] "}</Text>
      <Throbber variant="braille" />
      <Text>{` ${row.branch}  starting session...`}</Text>
    </Box>
  );
}

function ProjectHeaderRow({ project, collapsed }: { project: ProjectView; collapsed: boolean }) {
  return (
    <Text bold>
      {collapsed ? "▶" : "▼"} {project.label} - {project.counts.worktrees} worktrees
    </Text>
  );
}

function EmptyProjectRow({ project }: { project: ProjectView }) {
  return <Text color="gray"> {project.counts.worktrees} worktrees</Text>;
}

function DashboardFooter({ columns, quitHint }: { columns: number; quitHint: string }) {
  const full = `N:new R:rename Z:refresh 1-9/a-z:open X:remove /:search C:collapse H:help ${quitHint}`;
  const compactClose = `Q/esc:close N:new Z:refresh 1-9/a-z:open X:remove /:search H:help`;
  const label = quitHint === "Q/esc:close" && full.length > columns ? compactClose : full;
  return (
    <Box flexShrink={0}>
      <Text wrap="truncate-end">{label}</Text>
    </Box>
  );
}
