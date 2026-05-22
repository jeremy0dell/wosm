import type { ProjectView, SafeError, WorktreeRow, WosmSnapshot } from "@wosm/contracts";
import type { TuiUiState } from "./uiState.js";

export type ProjectGroup = {
  project: ProjectView;
  rows: WorktreeRow[];
  collapsed: boolean;
};

export type NewSessionAvailability =
  | {
      available: true;
      project: ProjectView;
    }
  | {
      available: false;
      project?: ProjectView;
      error: SafeError;
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

export function selectSelectedRow(
  snapshot: WosmSnapshot,
  state: TuiUiState,
): WorktreeRow | undefined {
  const visibleRows = selectVisibleRows(snapshot, state);
  if (state.selectedWorktreeId !== undefined) {
    const selected = visibleRows.find((row) => row.id === state.selectedWorktreeId);
    if (selected !== undefined) {
      return selected;
    }
  }
  return visibleRows[0];
}

export function selectNewSessionAvailability(
  snapshot: WosmSnapshot,
  state: TuiUiState,
): NewSessionAvailability {
  const project = selectNewSessionProject(snapshot, state);
  if (project === undefined) {
    return {
      available: false,
      error: {
        tag: "CommandValidationError",
        code: "PROJECT_NOT_CONFIGURED",
        message: "No project is configured for a new session.",
        hint: "Add a project to config.toml and run wosm reconcile.",
      },
    };
  }

  if (project.health.status === "unavailable") {
    return {
      available: false,
      project,
      error:
        project.health.lastError ??
        ({
          tag: "ProviderUnavailableError",
          code: "WORKTREE_PROVIDER_UNAVAILABLE",
          message: "The worktree provider is unavailable.",
          hint: "Run wosm doctor for provider diagnostics.",
          provider: project.health.providerId,
        } satisfies SafeError),
    };
  }

  return { available: true, project };
}

function selectNewSessionProject(
  snapshot: WosmSnapshot,
  state: TuiUiState,
): ProjectView | undefined {
  const selected = selectSelectedRow(snapshot, state);
  const selectedProject =
    selected === undefined
      ? undefined
      : snapshot.projects.find((project) => project.id === selected.projectId);
  return selectedProject ?? snapshot.projects[0];
}

function compareRows(left: WorktreeRow, right: WorktreeRow): number {
  const priority = left.display.sortPriority - right.display.sortPriority;
  if (priority !== 0) {
    return priority;
  }
  return left.branch.localeCompare(right.branch);
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
