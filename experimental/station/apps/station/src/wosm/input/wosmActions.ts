// Execution layer for the WOSM view's input. Keyboard input always flows
// through the shared transition machine (single behavioral source); this
// module is the semantic entry point mouse targets and chrome (footer hints)
// use to reach the same machine, plus the few Station mouse extensions that
// have no keyboard path in apps/tui (direct project-header collapse, wheel
// paging). Every mutation here lands via store.handleKey or a shared pure
// state function — no bespoke screen logic.
import type { StoreApi } from "zustand/vanilla";
import { selectDashboardViewport } from "@wosm/dashboard-core";
import { clampDashboardStateScroll, scrollDashboard } from "@wosm/dashboard-core";
import type { TuiKey } from "@wosm/dashboard-core";
import type { TuiHandleKeyResult, TuiStore } from "@wosm/dashboard-core";
import {
  agentWorktreePaneId,
  projectPaneId,
  worktreePaneId,
  type PaneId,
  type PaneRole,
} from "../../state/types.js";
import { resolveHarnessCommand } from "../harnessCommand.js";
import { sequenceToTuiKey } from "./sequenceToTuiKey.js";
import { matchWosmBinding, deriveWosmMode, type WosmBinding } from "./wosmKeymap.js";

export type WosmKeyOutcome =
  /** Dispatched into the machine; the overlay stays up. */
  | { kind: "handled" }
  /** The machine reported dismiss/exit intent; the router closes WOSM mode. */
  | { kind: "close-overlay" }
  /** No dashboard vocabulary for this sequence; swallowed, never dispatched. */
  | { kind: "unmapped" };

/**
 * The keyboard entry point the overlay keymap layer delegates to: translate
 * the normalized legacy sequence, dispatch through the machine, map the
 * transition meta to an outcome. Modal by construction — every sequence is
 * consumed whether or not it meant anything.
 */
export function handleWosmSequence(store: StoreApi<TuiStore>, sequence: string): WosmKeyOutcome {
  const key = sequenceToTuiKey(sequence);
  if (key === undefined) {
    return { kind: "unmapped" };
  }
  return outcomeForResult(store.getState().handleKey(key));
}

export function dispatchWosmKey(store: StoreApi<TuiStore>, key: TuiKey): WosmKeyOutcome {
  return outcomeForResult(store.getState().handleKey(key));
}

function outcomeForResult(result: TuiHandleKeyResult): WosmKeyOutcome {
  if (result.dismissPopup || result.exitCode !== undefined) {
    return { kind: "close-overlay" };
  }
  return { kind: "handled" };
}

/**
 * Synthesizes the representative key for a binding so clickable chrome
 * (footer hints, help rows) can dispatch exactly what pressing the key
 * would. Slot and text patterns have no single representative key.
 */
export function representativeKeyForBinding(binding: WosmBinding): TuiKey | undefined {
  const pattern = binding.pattern;
  switch (pattern.kind) {
    case "char":
      return pattern.ctrl === true ? { input: pattern.char, ctrl: true } : { input: pattern.char };
    case "named":
      switch (pattern.named) {
        case "return":
          return { input: "\r", return: true };
        case "escape":
          return { input: "", escape: true };
        case "backspace":
          return { input: "", backspace: true };
        case "delete":
          return { input: "", delete: true };
        case "up":
          return { input: "", upArrow: true };
        case "down":
          return { input: "", downArrow: true };
        case "left":
          return { input: "", leftArrow: true };
        case "right":
          return { input: "", rightArrow: true };
      }
      return undefined;
    case "slot":
    case "text":
      return undefined;
  }
}

/**
 * Dispatches a row interaction as the row's current slot key, so a click
 * means exactly what the slot accelerator means in the active mode
 * (dashboard: start-or-focus; remove/rename choose-slot: choose this row).
 * Rows without a slot (pending-operation rows) are inert.
 */
export function dispatchRowSlot(store: StoreApi<TuiStore>, rowId: string): WosmKeyOutcome {
  const state = store.getState();
  if (state.snapshot === undefined) {
    return { kind: "handled" };
  }
  const choice = selectDashboardViewport(state.snapshot, state).rowChoices.find(
    (candidate) => candidate.value.id === rowId,
  );
  if (choice === undefined) {
    return { kind: "handled" };
  }
  return dispatchWosmKey(store, { input: choice.key });
}

/**
 * Where an open-pane trigger should land: a deterministic pane id plus the cwd
 * the process spawns in, tagged with its `role`. A `"shell"` target carries no
 * command (the registry spawns the default shell); a `"primary-agent"` target
 * carries the harness launch command/args and the worktree id it belongs to.
 * Undefined when the row/project can't be resolved from the current snapshot,
 * which the router maps to an inert `handled` (no pane churn).
 *
 * `command`/`args`/`worktreeId` are kept optional so the `[+sh]` shell path
 * stays byte-for-byte unchanged (honoring exactOptionalPropertyTypes: absent,
 * not set to undefined).
 */
export type OpenPaneTarget = {
  paneId: PaneId;
  cwd: string;
  role: PaneRole;
  command?: string;
  args?: readonly string[];
  worktreeId?: string;
};

/**
 * The result of resolving a worktree row to its primary-agent launch. Pure and
 * testable: routing turns each variant into an outcome (launch → open-pane,
 * unresolved-harness → toast, none → inert). `none` covers a stale/absent row
 * or missing snapshot; `unresolved-harness` carries the id so the toast can
 * name it.
 */
export type RowAgentTarget =
  | { kind: "launch"; target: OpenPaneTarget }
  | { kind: "unresolved-harness"; harness: string }
  | { kind: "none" };

/**
 * Resolve a worktree row to its primary-agent launch. The harness comes from
 * the row's project defaults (a session's agent is the project's default
 * harness); an unknown/unresolvable harness yields `unresolved-harness` so the
 * caller can surface a toast instead of launching nothing silently.
 */
export function resolveRowAgentTarget(store: StoreApi<TuiStore>, rowId: string): RowAgentTarget {
  const snapshot = store.getState().snapshot;
  if (snapshot === undefined) {
    return { kind: "none" };
  }
  const row = snapshot.rows.find((candidate) => candidate.id === rowId);
  if (row === undefined) {
    return { kind: "none" };
  }
  const harness = snapshot.projects.find((project) => project.id === row.projectId)?.defaults
    .harness;
  if (harness === undefined) {
    return { kind: "none" };
  }
  const spawn = resolveHarnessCommand(harness);
  if (spawn === undefined) {
    return { kind: "unresolved-harness", harness };
  }
  return {
    kind: "launch",
    target: {
      paneId: agentWorktreePaneId(row.id),
      cwd: row.path,
      role: "primary-agent",
      command: spawn.command,
      args: spawn.args,
      worktreeId: row.id,
    },
  };
}

/**
 * Resolve a worktree row to its shell pane target; cwd is the worktree's
 * checkout path. Resolves against the snapshot's worktree rows rather than the
 * dashboard's `rowChoices`: opening a shell in a worktree is orthogonal to
 * whether an agent is starting there or the worktree is being removed, and
 * `rowChoices` filters out exactly those transient-state rows (pending-start /
 * pending-remove) that still render a clickable `[+sh]`. Reading `snapshot.rows`
 * keeps `[+sh]` live for any real worktree and mirrors resolveProjectPaneTarget,
 * which reads `snapshot.projects`. An id with no matching row is inert.
 */
export function resolveRowPaneTarget(
  store: StoreApi<TuiStore>,
  rowId: string,
): OpenPaneTarget | undefined {
  const snapshot = store.getState().snapshot;
  if (snapshot === undefined) {
    return undefined;
  }
  const row = snapshot.rows.find((candidate) => candidate.id === rowId);
  if (row === undefined) {
    return undefined;
  }
  return { paneId: worktreePaneId(row.id), cwd: row.path, role: "shell" };
}

/**
 * Resolve a project header to its shell pane target; cwd is the project root.
 * Projects come straight off the snapshot (headers are not row choices).
 */
export function resolveProjectPaneTarget(
  store: StoreApi<TuiStore>,
  projectId: string,
): OpenPaneTarget | undefined {
  const snapshot = store.getState().snapshot;
  if (snapshot === undefined) {
    return undefined;
  }
  const project = snapshot.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) {
    return undefined;
  }
  return { paneId: projectPaneId(project.id), cwd: project.root, role: "shell" };
}

/**
 * Station mouse extension: direct project collapse toggle (apps/tui's
 * keyboard path goes through the C prompt; the visual notes specify
 * header-click toggle). Same state mutation the collapse screen performs.
 */
export function toggleProjectCollapsed(store: StoreApi<TuiStore>, projectId: string): void {
  const state = store.getState();
  const collapsedProjectIds = new Set(state.collapsedProjectIds);
  if (collapsedProjectIds.has(projectId)) {
    collapsedProjectIds.delete(projectId);
  } else {
    collapsedProjectIds.add(projectId);
  }
  store.setState(clampDashboardStateScroll({ ...state, collapsedProjectIds }));
}

/** Wheel/indicator scrolling via the shared scroll math. */
export function scrollWosmView(store: StoreApi<TuiStore>, delta: number): void {
  store.setState(scrollDashboard(store.getState(), delta));
}

export function dismissWosmToasts(store: StoreApi<TuiStore>): void {
  store.getState().dismissToasts();
}

/**
 * Dispatches a footer/help hint click as its binding's representative key,
 * but only when the binding belongs to the active mode (a stale hint from a
 * just-closed mode must not fire).
 */
export function dispatchBindingClick(
  store: StoreApi<TuiStore>,
  binding: WosmBinding,
): WosmKeyOutcome {
  const mode = deriveWosmMode(store.getState());
  const key = representativeKeyForBinding(binding);
  if (key === undefined) {
    return { kind: "handled" };
  }
  const active = matchWosmBinding(mode, key);
  if (active?.id !== binding.id) {
    return { kind: "handled" };
  }
  return dispatchWosmKey(store, key);
}
