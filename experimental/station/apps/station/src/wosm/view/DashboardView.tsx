// OpenTUI rewrite of apps/tui's Dashboard component (the render layer only —
// every string, width, and ordering decision comes from the shared layout
// and content modules, so parity holds by construction). One <text> per
// dashboard line; the shared viewport selector already sized the line list
// to the available rows. Mouse targets report through the wosm mouse
// context; hover is component-local and color-only so golden frames stay
// layout-stable.
import { TextAttributes } from "@opentui/core";
import type { ProjectView, WosmSnapshot } from "@wosm/contracts";
import { useState } from "react";
import {
  dashboardFooterLabel,
  dashboardHeaderLine,
  emptyProjectLabel,
  FIRST_RUN_BODY_LABEL,
  projectHeaderLabel,
  rowGridInputForViewportItem,
  scrollIndicatorLabel,
  type DashboardHeaderStatus,
  type TopRowWidgetText,
} from "@wosm/dashboard-core";
import {
  layoutWorktreeRowGrid,
  truncateCells,
  type RowGridLayout,
} from "@wosm/dashboard-core";
import {
  selectDashboardViewport,
  type DashboardViewportItem,
} from "@wosm/dashboard-core";
import type { TuiViewState } from "@wosm/dashboard-core";
import { Segments } from "./segments.js";
import { WOSM_COLORS } from "./theme.js";
import { useWosmMouse, wosmMouseProps } from "./wosmMouseContext.js";

const HOVER_BG = "#1f242b";

export type DashboardViewProps = {
  snapshot: WosmSnapshot;
  viewState: TuiViewState;
  columns?: number;
  topRowWidgets?: readonly TopRowWidgetText[];
  observerStatus?: DashboardHeaderStatus;
};

const PRODUCT_LABEL = "wosm";
const QUIT_HINT = "Q/esc:close";

export function DashboardView({
  snapshot,
  viewState,
  columns = 80,
  topRowWidgets = [],
  observerStatus,
}: DashboardViewProps) {
  const dispatch = useWosmMouse();
  const viewport = selectDashboardViewport(snapshot, viewState);
  const contentColumns = Math.max(1, Math.floor(columns) - 1);
  const firstRun = snapshot.projects.length === 0;
  return (
    <box
      width="100%"
      flexGrow={1}
      flexDirection="column"
      paddingRight={1}
      onMouseScroll={wosmMouseProps(dispatch, { kind: "body" }).onMouseScroll}
    >
      <DashboardHeaderRow
        columns={contentColumns}
        widgets={topRowWidgets}
        {...(observerStatus === undefined ? {} : { status: observerStatus })}
      />
      <Divider columns={contentColumns} />
      <ScrollIndicatorRow direction="above" hiddenCount={viewport.hiddenAbove} />
      {firstRun ? (
        <box flexDirection="column" flexGrow={1}>
          <text fg={WOSM_COLORS.foreground}>{truncateCells(FIRST_RUN_BODY_LABEL, contentColumns)}</text>
        </box>
      ) : (
        <DashboardBody
          columns={contentColumns}
          items={viewport.visibleItems}
          keyByRow={new Map(viewport.displayRowChoices.map((choice) => [choice.value.id, choice.key]))}
        />
      )}
      <ScrollIndicatorRow direction="below" hiddenCount={viewport.hiddenBelow} />
      <Divider columns={contentColumns} />
      <text fg={WOSM_COLORS.foreground}>
        {truncateCells(
          dashboardFooterLabel({ columns: contentColumns, quitHint: QUIT_HINT, firstRun }),
          contentColumns,
        )}
      </text>
    </box>
  );
}

export function DashboardHeaderRow({
  columns,
  widgets,
  status,
}: {
  columns: number;
  widgets: readonly TopRowWidgetText[];
  status?: DashboardHeaderStatus;
}) {
  const headerLine = dashboardHeaderLine({
    productLabel: PRODUCT_LABEL,
    columns,
    widgets,
    ...(status === undefined ? {} : { status }),
  });
  const suffix = headerLine.startsWith(PRODUCT_LABEL) ? headerLine.slice(PRODUCT_LABEL.length) : "";
  return (
    <text fg={WOSM_COLORS.foreground}>
      <span attributes={TextAttributes.BOLD}>{PRODUCT_LABEL}</span>
      {suffix}
    </text>
  );
}

export function Divider({ columns }: { columns: number }) {
  return <text fg={WOSM_COLORS.gray}>{"─".repeat(Math.max(1, columns))}</text>;
}

function ScrollIndicatorRow({
  direction,
  hiddenCount,
}: {
  direction: "above" | "below";
  hiddenCount: number;
}) {
  const dispatch = useWosmMouse();
  return (
    <box height={1}>
      {hiddenCount > 0 ? (
        <text
          fg={WOSM_COLORS.gray}
          {...wosmMouseProps(dispatch, {
            kind: "scrollIndicator",
            direction: direction === "above" ? "up" : "down",
          })}
        >
          {scrollIndicatorLabel(direction, hiddenCount)}
        </text>
      ) : null}
    </box>
  );
}

function DashboardBody({
  columns,
  items,
  keyByRow,
}: {
  columns: number;
  items: readonly DashboardViewportItem[];
  keyByRow: ReadonlyMap<string, string>;
}) {
  const rowInputs = items.flatMap((item) => {
    const input = rowGridInputForViewportItem(item, keyByRow);
    return input === undefined ? [] : [input];
  });
  const rowLayouts = layoutWorktreeRowGrid({ columns, rows: rowInputs });
  const layoutByItem = new Map(rowLayouts.map((layout) => [layout.id, layout]));
  return (
    <box flexDirection="column" flexGrow={1}>
      {items.map((item) => (
        <DashboardViewportRow
          key={item.id}
          columns={columns}
          item={item}
          layout={layoutByItem.get(item.id)}
        />
      ))}
    </box>
  );
}

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
      return <box height={1} />;
    case "projectHeader":
      return <ProjectHeaderLine columns={columns} project={item.project} collapsed={item.collapsed} />;
    case "emptyProject":
      return <text fg={WOSM_COLORS.gray}>{truncateCells(emptyProjectLabel(item.project), columns)}</text>;
    case "worktree":
      return layout === undefined ? null : (
        <WorktreeRowLine rowId={item.row.id} layout={layout} />
      );
    case "createLocalRow":
      // Local create rows have no slot and no activation target.
      return layout === undefined ? null : (
        <text fg={WOSM_COLORS.foreground}>
          <Segments segments={layout.segments} />
        </text>
      );
  }
}

function WorktreeRowLine({ rowId, layout }: { rowId: string; layout: RowGridLayout }) {
  const dispatch = useWosmMouse();
  const [hover, setHover] = useState(false);
  return (
    <text
      fg={WOSM_COLORS.foreground}
      {...(hover ? { bg: HOVER_BG } : {})}
      {...wosmMouseProps(dispatch, { kind: "row", rowId })}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <Segments segments={layout.segments} />
    </text>
  );
}

function ProjectHeaderLine({
  columns,
  project,
  collapsed,
}: {
  columns: number;
  project: ProjectView;
  collapsed: boolean;
}) {
  const dispatch = useWosmMouse();
  const [hover, setHover] = useState(false);
  return (
    <text
      fg={WOSM_COLORS.foreground}
      attributes={TextAttributes.BOLD}
      {...(hover ? { bg: HOVER_BG } : {})}
      {...wosmMouseProps(dispatch, { kind: "projectHeader", projectId: project.id })}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      {truncateCells(projectHeaderLabel(project, collapsed), columns)}
    </text>
  );
}
