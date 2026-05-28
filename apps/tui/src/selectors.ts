import type { ProjectView, WorktreeRow, WosmSnapshot } from "@wosm/contracts";
import type { TuiUiState } from "./uiState.js";

export type ProjectGroup = {
  project: ProjectView;
  rows: WorktreeRow[];
  collapsed: boolean;
};

export function selectProjectGroups(snapshot: WosmSnapshot, state: TuiUiState): ProjectGroup[] {
  const query = normalizeSearch(state.searchQuery);
  return snapshot.projects.map((project) => {
    const collapsed = state.collapsedProjectIds.has(project.id);
    const matchingRows = snapshot.rows
      .filter((row) => row.projectId === project.id)
      .filter((row) => rowMatchesSearch(row, project, query))
      .sort(compareRows);
    return {
      project,
      rows: collapsed ? [] : matchingRows,
      collapsed,
    };
  });
}

export function selectVisibleRows(snapshot: WosmSnapshot, state: TuiUiState): WorktreeRow[] {
  return selectProjectGroups(snapshot, state).flatMap((group) => group.rows);
}

export function selectKeySlots(
  snapshot: WosmSnapshot,
  state: TuiUiState,
): Map<string, WorktreeRow> {
  const slots = new Map<string, WorktreeRow>();
  const rows = selectVisibleRows(snapshot, state).slice(0, 9);
  for (const [index, row] of rows.entries()) {
    slots.set(String(index + 1), row);
  }
  return slots;
}

export function selectProjectSlots(
  snapshot: WosmSnapshot,
  state: TuiUiState,
): Map<string, ProjectView> {
  const slots = new Map<string, ProjectView>();
  const groups = selectProjectGroups(snapshot, state).slice(0, 9);
  for (const [index, group] of groups.entries()) {
    slots.set(String(index + 1), group.project);
  }
  return slots;
}

function compareRows(left: WorktreeRow, right: WorktreeRow): number {
  return (
    left.branch.localeCompare(right.branch) ||
    left.path.localeCompare(right.path) ||
    left.id.localeCompare(right.id)
  );
}

function rowMatchesSearch(row: WorktreeRow, project: ProjectView, query: string): boolean {
  if (query.length === 0) {
    return true;
  }
  return [
    row.branch,
    row.display.statusLabel,
    row.display.reason,
    row.agent?.harness,
    row.terminal?.provider,
    project.label,
  ].some((value) => normalizeSearch(value ?? "").includes(query));
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}
