# TUI Screen-Driven State Transition Plan

Status: active planning doc.

## Goal

Simplify `apps/tui` state management, concepts, and readability by making the current screen the primary owner of key handling.

The target model is:

```text
screen state + key => next screen state + optional observer command/request
observer event => next screen state
```

The TUI should become easier to answer questions about:

- What screen is active?
- What does this key mean right now?
- What observer command, if any, is sent?
- What observer event changes the rendered state?

This plan is intentionally about reducing concepts. It should not introduce a large framework, a generic state machine library, or new vocabulary unless it removes more complexity than it adds.

## Current Problem

The current TUI has individually reasonable pieces, but common user flows are scattered across too many concepts and files.

For example, removing a worktree currently crosses:

- input capture and normalization
- dashboard key handling
- prompt mode routing
- prompt-specific input handling
- UI prompt state
- cleanup action naming
- observer command construction
- dashboard command dispatch and toast handling
- observer event application

The concepts are also overloaded:

- `input` can mean raw keys or semantic interaction.
- `action` can mean cleanup action, flow action, or generic UI behavior.
- `command` can mean an observer command or a UI-level command-like action.
- `flow`, `mode`, and `prompt` overlap.

The result is that a simple question such as "what happens when I press `y` to remove a worktree?" requires reading several files and reconstructing the dataflow mentally.

## Vocabulary

Use a small set of terms with clear ownership:

- `TuiKey`: normalized raw key input from Ink.
- `TuiScreen`: what the TUI is currently showing or doing.
- `TuiState`: snapshot, loading state, active screen, and toasts.
- `TuiTransition`: result of handling a key: next state plus optional outside-world requests.
- `WosmCommand`: the only thing called a command. It is the typed observer command sent through the TUI service.

Avoid adding generic `Action`, `Intent`, `PromptMode`, or `FlowAction` vocabulary at the top level. Existing feature-local names can remain temporarily during migration, but new code should prefer screen/state/key/transition/observer command.

## Proposed Shape

Use a thin Zustand vanilla store for state ownership and React subscriptions. Zustand should only provide store mechanics; it should not define the architecture.

Proposed starter layout:

```text
apps/tui/src/state/
  index.ts
  keys.ts
  screen.ts
  transition.ts
  store.ts
  commandBuilders.ts
  screens/
    dashboard.ts
    help.ts
    search.ts
    removeWorktree.ts
    newSession.ts
```

Do not add `effects.ts` in the starter slice. Keep outside-world requests directly on `TuiTransition` until the set of request kinds proves it needs a separate abstraction.

Do not start with a generic `cleanup` screen. Use `removeWorktree` first because that is the current user-facing flow being simplified. Generalize only if multiple cleanup screens converge on the same state and key behavior.

## Core Types

`state/screen.ts` owns the primary model:

```ts
export type TuiState = {
  snapshot?: WosmSnapshot;
  loading: boolean;
  screen: TuiScreen;
  toasts: TuiToast[];
};

export type TuiScreen =
  | { name: "dashboard" }
  | { name: "help" }
  | { name: "search"; value: string }
  | { name: "removeWorktree"; step: "chooseSlot" }
  | {
      name: "removeWorktree";
      step: "confirm";
      rowId: WorktreeId;
      forceRequired: boolean;
      label: string;
    }
  | { name: "newSession"; flow: NewSessionFlowState };
```

`state/keys.ts` owns raw key normalization:

```ts
export type TuiKey = {
  input: string;
  ctrl?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
};
```

`state/transition.ts` owns key transition dispatch:

```ts
export type TuiTransition = {
  state: TuiState;
  commands?: WosmCommand[];
  reconcileReason?: string;
  exitCode?: number;
  dismissPopup?: true;
};

export function handleTuiKey(state: TuiState, key: TuiKey): TuiTransition {
  switch (state.screen.name) {
    case "dashboard":
      return handleDashboardKey(state, key);
    case "help":
      return handleHelpKey(state, key);
    case "search":
      return handleSearchKey(state, key);
    case "removeWorktree":
      return handleRemoveWorktreeKey(state, key);
    case "newSession":
      return handleNewSessionKey(state, key);
  }
}
```

The transition type deliberately uses `commands` for observer `WosmCommand` values only. Non-command requests such as reconcile, exit, and popup dismissal stay separate to preserve the distinction.

## Zustand Role

Use a scoped vanilla store, not a global singleton. Each rendered TUI gets its own store instance, which keeps tests isolated and avoids hidden cross-run state.

`state/store.ts` owns:

- initial snapshot loading
- observer event subscription and reconnect loop
- applying `handleTuiKey` results
- dispatching returned `WosmCommand` values through `TuiObserverService`
- converting service errors to toasts
- popup dismissal and exit callbacks

The store should be the only place in the new state layer that calls `TuiObserverService`.

Screen modules should remain pure TypeScript:

```text
TuiState + TuiKey => TuiTransition
```

## Screen Modules

Each file under `state/screens/` answers one question: what does a key mean while this screen is active?

### Dashboard

`state/screens/dashboard.ts` owns normal dashboard keys:

- `H` or `?` opens help.
- `/` opens search.
- `r` requests reconcile.
- `x` starts `removeWorktree`.
- `n` starts `newSession`.
- `1-9` dispatches the primary row observer command.
- `q` exits or dismisses popup, depending on runtime options carried by state or store environment.

### Remove Worktree

`state/screens/removeWorktree.ts` owns the full remove interaction:

```text
dashboard + x => removeWorktree chooseSlot
chooseSlot + 1-9 => removeWorktree confirm(row)
confirm + y => dashboard + worktree.remove command
confirm + n/Esc/Enter => dashboard
```

This file is where `y` should live. The confirm key should not be handled by a generic prompt module.

### New Session

`state/screens/newSession.ts` should wrap the existing pure new-session flow first:

- `createNewSessionFlow`
- `newSessionIntentForInput`
- `transitionNewSessionFlow`
- `validateNewSessionCreate`

The active screen becomes:

```ts
{ name: "newSession"; flow: NewSessionFlowState }
```

Over time, rename the internal `NewSessionFlowState` discriminator from `mode` to `step` if that reduces confusion with top-level screens.

### Search And Help

`state/screens/search.ts` owns search text editing and closing.

`state/screens/help.ts` owns help dismissal.

Neither should know about observer services.

## Command Builders

Move or rename `apps/tui/src/actions/actions.ts` to `apps/tui/src/state/commandBuilders.ts` in the migration.

The reason is naming clarity: these functions build typed observer commands. They are not UI actions.

Expected contents:

- `buildFocusCommand`
- `buildStartAgentCommand`
- `buildCreateSessionCommand`
- `buildReconcileCommand`
- `buildCleanupCommand`
- `cleanupForceRequired`

If `buildCleanupCommand` remains too generic after the screen refactor, split concrete builders such as `buildRemoveWorktreeCommand`.

## Observer Events

Keep `apps/tui/src/eventReducer/eventReducer.ts` for the starter migration.

It already expresses:

```text
snapshot + observer event => snapshot patch + toasts + refresh flag
```

The Zustand store can call it from `handleObserverEvent`. Only move it under `state/` later if doing so makes imports clearer.

## React Wiring

`App` should become mostly wiring:

- create/provide the TUI store
- capture Ink input and call `store.handleKey(normalizeTuiKey(input, key))`
- subscribe to the pieces needed for rendering
- render components from `TuiState`

Presentation components should receive `snapshot`, `screen`, and `toasts`, not command dispatch callbacks or prompt mutation callbacks.

The old local state split should disappear over time:

- `newSessionStateRef`
- `renderedNewSessionState`
- `promptValueRef`
- `promptModeRef`
- separate `TuiUiState.prompt`

## Expected Removals Or Simplifications

Likely removed or heavily simplified:

- `apps/tui/src/hooks/useDashboardInput.ts`
- `apps/tui/src/hooks/useObserverDashboard.ts`
- `apps/tui/src/input/dashboardModeRegistry.ts`
- `apps/tui/src/input/dashboardInput.ts`
- `apps/tui/src/input/dashboardKeyInput.ts`
- `apps/tui/src/input/promptInput.ts`
- `apps/tui/src/input/newSessionInput.ts`
- `apps/tui/src/uiState/uiState.ts`

Likely renamed or moved:

- `apps/tui/src/actions/actions.ts` to `apps/tui/src/state/commandBuilders.ts`

Likely kept:

- `apps/tui/src/flows/newSession.ts` as pure feature logic
- `apps/tui/src/flows/stepWizard.ts`
- `apps/tui/src/eventReducer/eventReducer.ts`
- `apps/tui/src/selectors/selectors.ts`
- `apps/tui/src/services/*`
- `apps/tui/src/components/*`, with prop shape updates

## Migration Strategy

Use small vertical slices. Do not rewrite all screens at once.

1. Add Zustand and the `state/` starter types with no behavior change.
2. Move command builders from `actions/actions.ts` to `state/commandBuilders.ts`, keeping exports compatible while tests move.
3. Move remove worktree into `state/screens/removeWorktree.ts` and prove `x -> slot -> y` with focused tests.
4. Move dashboard key handling into `state/screens/dashboard.ts`.
5. Replace prompt state with `TuiScreen` for remove/search only.
6. Move new session entry and input handling into `state/screens/newSession.ts`, wrapping the existing pure flow.
7. Replace `useDashboardInput` and `useObserverDashboard` with `state/store.ts` and thin `App` wiring.
8. Remove obsolete prompt/mode/input modules once no imports remain.
9. Update `docs/tui.md` after the new architecture is implemented and tested.

## Testing Strategy

Add pure state tests first, then keep the existing integration tests green.

Focused tests should cover:

- `dashboard + x` opens remove slot selection.
- `removeWorktree chooseSlot + digit` opens confirm for the selected row.
- `removeWorktree confirm + y` returns a `worktree.remove` command and dashboard state.
- `removeWorktree confirm + n/Esc/Enter` returns dashboard state and no command.
- `dashboard + n` opens new session or adds a safe error toast when no project exists.
- new-session submit returns a `session.create` command.
- observer `worktree.removed` event removes the row from rendered state.
- observer `command.failed` event adds an error toast.

Keep existing interaction tests as safety coverage while the internals move.

Useful focused commands during the migration:

```bash
pnpm exec vitest run apps/tui/src/state --config config/vitest/vitest.unit.config.ts
pnpm exec vitest run apps/tui/src/input/__tests__/command-ux.integration.test.tsx --config config/vitest/vitest.integration.config.ts
pnpm exec vitest run apps/tui/src/App/__tests__/app-render.integration.test.tsx --config config/vitest/vitest.integration.config.ts
pnpm typecheck
pnpm lint
```

## Review Checklist

- Can a reviewer find what a key does by opening one screen module?
- Is `WosmCommand` the only concept called a command?
- Did the change remove generic prompt/action/mode vocabulary instead of renaming it?
- Are screen modules pure and service-free?
- Does the Zustand store remain thin store/effect wiring rather than business logic?
- Do React components render state instead of owning TUI transitions?
- Are observer/provider boundaries unchanged?

## UX Implication

The intended user-facing behavior should not change in the starter migration. The UX win is maintainability: key flows like remove worktree should become easier to reason about and safer to modify.

Manual verification should use the TUI:

1. Open `pnpm wosm tui`.
2. Press `x`, select a visible row slot, then press `n` or `Esc` and confirm no command is dispatched.
3. Repeat with `y` on a disposable worktree and confirm the row disappears or a clear error toast appears.
4. Press `n` and verify the new-session bottom sheet still behaves as before.
