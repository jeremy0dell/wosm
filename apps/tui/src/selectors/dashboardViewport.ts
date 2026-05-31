import type { ProjectId, ProjectView, WorktreeRow, WosmSnapshot } from "@wosm/contracts";
import { clampDashboardScrollOffset, dashboardBodyRows } from "../components/Dashboard/layout.js";
import type { TuiViewState } from "../state/screen.js";
import { type KeyedChoice, keyChoices, selectProjectGroups } from "./selectors.js";

export type DashboardViewportItem =
  | {
      type: "projectGap";
      id: string;
      projectId: ProjectId;
    }
  | {
      type: "projectHeader";
      id: string;
      project: ProjectView;
      collapsed: boolean;
    }
  | {
      type: "emptyProject";
      id: string;
      project: ProjectView;
    }
  | {
      type: "worktree";
      id: string;
      row: WorktreeRow;
    };

export type DashboardViewport = {
  bodyRows: number;
  clampedScrollOffset: number;
  hiddenAbove: number;
  hiddenBelow: number;
  items: DashboardViewportItem[];
  visibleItems: DashboardViewportItem[];
  rowChoices: Array<KeyedChoice<WorktreeRow>>;
};

export function selectDashboardViewport(
  snapshot: WosmSnapshot,
  state: TuiViewState,
): DashboardViewport {
  const items = selectDashboardItems(snapshot, state);
  const bodyRows = dashboardBodyRows(state.terminalRows);
  const clampedScrollOffset = clampDashboardScrollOffset({
    bodyRows,
    itemCount: items.length,
    scrollOffset: state.scrollOffset,
  });
  const visibleItems = items.slice(clampedScrollOffset, clampedScrollOffset + bodyRows);
  const hiddenAbove = clampedScrollOffset;
  const hiddenBelow = Math.max(0, items.length - clampedScrollOffset - bodyRows);
  return {
    bodyRows,
    clampedScrollOffset,
    hiddenAbove,
    hiddenBelow,
    items,
    visibleItems,
    rowChoices: keyChoices(worktreeRowsFromItems(visibleItems)),
  };
}

export function selectDashboardItems(
  snapshot: WosmSnapshot,
  state: TuiViewState,
): DashboardViewportItem[] {
  return selectProjectGroups(snapshot, state).flatMap((group) => {
    const items: DashboardViewportItem[] = [
      {
        type: "projectGap",
        id: `gap:${group.project.id}`,
        projectId: group.project.id,
      },
      {
        type: "projectHeader",
        id: `project:${group.project.id}`,
        project: group.project,
        collapsed: group.collapsed,
      },
    ];
    if (group.collapsed) {
      return items;
    }
    if (group.rows.length === 0) {
      items.push({
        type: "emptyProject",
        id: `empty:${group.project.id}`,
        project: group.project,
      });
      return items;
    }
    for (const row of group.rows) {
      items.push({
        type: "worktree",
        id: `worktree:${row.id}`,
        row,
      });
    }
    return items;
  });
}

function worktreeRowsFromItems(items: readonly DashboardViewportItem[]): WorktreeRow[] {
  return items.flatMap((item) => (item.type === "worktree" ? [item.row] : []));
}
