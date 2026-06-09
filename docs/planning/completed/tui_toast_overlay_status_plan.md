# TUI Toast Overlay And Observer Status Plan

Status: completed implementation record
Date: 2026-06-08
Scope: `apps/tui` toast presentation, toast lifecycle, and observer reconnect/display-only status copy.

This plan turns the current bottom toast list into a real terminal overlay surface and separates ordinary action feedback from expected observer reconnect noise. It is a TUI-local UX change. It should not widen protocol contracts, add provider-specific imports, or make the TUI read observer persistence directly.

## Current Problem

Today `ToastStack` renders the newest three toast entries as plain text in the lower status area. During observer restarts, the TUI can append the same socket error repeatedly because startup and reconnect paths both touch the observer socket:

```text
could not connect to observer socket /Users/.../observer.sock.
could not connect to observer socket /Users/.../observer.sock.
could not connect to observer socket /Users/.../observer.sock.
```

The visible `3` is not meaningful user state. It is the render cap for a growing toast array. The useful user state is:

```text
observer is reconnecting
the dashboard is showing the last known snapshot, if one exists
commands may not be accepted until the observer returns
```

## Goals

- Render toasts as an overlay sheet, not as a rotating bottom log.
- Show one active toast at a time, with graceful entry, lifetime, and dismissal.
- Treat repeated identical toasts as one refreshed toast, not as a count.
- Move observer-reconnect noise into a calm status surface with display-only copy.
- Preserve the footer, prompts, bottom sheets, and dashboard scroll viewport without overlap.
- Keep all state and rendering local to `apps/tui`.
- Cover presentation, lifecycle, observer reconnect state, and full app interaction in focused tests.

## Non-Goals

- No observer, protocol, or contract schema change in the first slice.
- No provider-specific diagnostics in normal TUI rendering.
- No notification drawer or scrollback history.
- No command/action projection framework beyond the existing local operation behavior.
- No new global command palette or help redesign.

## UX Model

### Toast Events

`TuiToast` remains the semantic input:

```ts
type TuiToast = {
  kind: "info" | "success" | "error";
  message: string;
  hint?: string;
  commandId?: string;
  traceId?: string;
  diagnosticId?: string;
};
```

The store wraps it in TUI-local lifecycle metadata:

```ts
type TuiToastEntry = {
  id: string;
  toast: TuiToast;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | undefined;
};
```

The same toast key refreshes the existing entry instead of appending:

```text
kind + message + hint + commandId + traceId + diagnosticId
```

No `x3` count is shown. Repeated daemon reconnect failures are not action feedback; they become observer status instead.

### Toast Sheet

The toast sheet is a small floating overlay anchored near the lower-right of the app, above the footer and above prompts when prompts are open. It is visually a sheet, but not the full-width bottom sheet used by new-session flows.

Default lifetime:

```text
success: 2400ms
info:    3200ms
error:   8000ms
```

When the same toast repeats before expiry, refresh `updatedAt` and `expiresAt`. Do not add a second visible toast. Manual dismissal can use the existing `dismissToasts()` store action later; the first implementation can rely on lifecycle timers plus clearing when a newer toast replaces it.

### Observer Status

Observer connectivity is modeled separately from action toasts:

```ts
type TuiObserverConnectionStatus =
  | { state: "connected" }
  | { state: "reconnecting"; since: number }
  | { state: "displayOnly"; since: number; lastError?: SafeError };
```

Recommended copy:

```text
observer reconnecting
display-only snapshot
```

For a cold start with no snapshot:

```text
waiting for observer
retrying connection
```

Avoid:

```text
offline
failed
x3
could not connect to observer socket ...
```

The raw socket error can stay available through debug logs and diagnostics. The normal TUI should describe the current mode.

## Mockups

### 1. Success Toast Sheet

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ wosm                                                 2:00 PM  NYC 91° ☀️  │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│ ▼ wosm - 4 worktrees | codex                                               │
│ [1] ○ hook-event-naming                 codex      idle              #42 ✓ │
│ [2] ◜ o11-tail-stream                   codex      working                 │
│ [3] ○ row-ui                            codex      idle       +309 -19 #49 ✓│
│ [4] ○ term-boundary                     codex      idle                    │
│                                                                            │
│                                    ╭─ saved ───────────────────────────╮   │
│                                    │ Session renamed.                  │   │
│                                    ╰───────────────────────────────────╯   │
│────────────────────────────────────────────────────────────────────────────│
│ N:new R:rename Z:refresh 1-9/a-z:open X:remove /:search C:collapse Q:quit │
└────────────────────────────────────────────────────────────────────────────┘
```

Behavior:

- Appears for successful local action completion.
- Auto-dismisses quickly.
- Does not claim a footer row.
- Replaced by newer action feedback.

### 2. Error Toast Sheet

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ wosm                                                 2:00 PM  NYC 91° ☀️  │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│ ▼ wosm - 4 worktrees | codex                                               │
│ [1] ○ hook-event-naming                 codex      idle              #42 ✓ │
│ [2] ◜ o11-tail-stream                   codex      working                 │
│ [3] ○ row-ui                            codex      idle       +309 -19 #49 ✓│
│ [4] ○ term-boundary                     codex      idle                    │
│                                                                            │
│                         ╭─ needs attention ────────────────────────────╮   │
│                         │ Worktree remove failed.                      │   │
│                         │ Run wosm debug trace trc_123 for details.    │   │
│                         ╰──────────────────────────────────────────────╯   │
│────────────────────────────────────────────────────────────────────────────│
│ N:new R:rename Z:refresh 1-9/a-z:open X:remove /:search C:collapse Q:quit │
└────────────────────────────────────────────────────────────────────────────┘
```

Behavior:

- Error toasts live longer than success/info.
- Diagnostic or trace details are secondary text, not raw stack/provider payload.
- Exact duplicate command-failure toasts refresh the active sheet instead of creating a new visible line.

### 3. Observer Reconnecting Status

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ wosm                    observer reconnecting · display-only snapshot      │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│ ▼ wosm - 4 worktrees | codex                                               │
│ [1] ○ hook-event-naming                 codex      idle              #42 ✓ │
│ [2] ◜ o11-tail-stream                   codex      working                 │
│ [3] ○ row-ui                            codex      idle       +309 -19 #49 ✓│
│ [4] ○ term-boundary                     codex      idle                    │
│                                                                            │
│                                                                            │
│────────────────────────────────────────────────────────────────────────────│
│ N:new R:rename Z:refresh 1-9/a-z:open X:remove /:search C:collapse Q:quit │
└────────────────────────────────────────────────────────────────────────────┘
```

Behavior:

- No toast spam.
- No repeat count.
- The dashboard stays visible because the TUI has a last known snapshot.
- The status clears after the next successful snapshot load or event subscription.

### 4. Cold Start Without Snapshot

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ wosm                                                 2:00 PM  NYC 91° ☀️  │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│ waiting for observer                                                       │
│ retrying connection                                                        │
│                                                                            │
│ The dashboard will appear when the observer is ready.                      │
│                                                                            │
│                                                                            │
│                                                                            │
│────────────────────────────────────────────────────────────────────────────│
│ Q:quit                                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

Behavior:

- Do not say `display-only` when there is no snapshot to display.
- Do not show the raw socket path.
- Keep this as loading/empty-state copy, not a toast.

### 5. Recovery Feedback

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ wosm                                                 2:01 PM  NYC 91° ☀️  │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│ ▼ wosm - 4 worktrees | codex                                               │
│ [1] ○ hook-event-naming                 codex      idle              #42 ✓ │
│ [2] ○ o11-tail-stream                   codex      idle                    │
│ [3] ○ row-ui                            codex      idle       +309 -19 #49 ✓│
│ [4] ○ term-boundary                     codex      idle                    │
│                                                                            │
│                                            ╭─ connected ───────────────╮   │
│                                            │ Observer reconnected.     │   │
│                                            ╰───────────────────────────╯   │
│────────────────────────────────────────────────────────────────────────────│
│ N:new R:rename Z:refresh 1-9/a-z:open X:remove /:search C:collapse Q:quit │
└────────────────────────────────────────────────────────────────────────────┘
```

Behavior:

- Optional.
- Only show if the TUI was reconnecting/display-only long enough to be user-visible, for example `> 1500ms`.
- Auto-dismiss quickly.

### 6. Narrow Width Fallback

```text
┌────────────────────────────────────────────┐
│ wosm        observer reconnecting          │
│────────────────────────────────────────────│
│                                            │
│ ▼ wosm - 4 worktrees | codex               │
│ [1] ○ hook-event-naming    codex idle #42 ✓│
│ [2] ◜ o11-tail-stream      codex working   │
│ [3] ○ row-ui               codex idle #49 ✓│
│                                            │
│        ╭─ needs attention ─────────╮       │
│        │ Worktree remove failed.   │       │
│        ╰───────────────────────────╯       │
│────────────────────────────────────────────│
│ N:new R:rename Z:refresh H:help Q:quit     │
└────────────────────────────────────────────┘
```

Behavior:

- The toast sheet becomes centered when there is not enough right-side room.
- Width is bounded by the viewport and message wraps/truncates predictably.
- Footer remains the bottom row.

## Implementation Plan

### Slice 1 - Toast Sheet Presentation And Lifecycle

Primary files:

```text
apps/tui/src/components/ToastStack/ToastStack.tsx
apps/tui/src/components/ToastStack/ToastStack.test.tsx
apps/tui/src/state/screen.ts
apps/tui/src/state/store.ts
apps/tui/src/App/App.tsx
apps/tui/src/App/__tests__/command-ux.integration.test.tsx
```

Implementation:

- Rename internally or replace `ToastStack` behavior with a one-toast overlay. Keeping the file path is acceptable to reduce churn; the rendered concept should be `ToastOverlay`.
- Add `TuiToastEntry` lifecycle state in `apps/tui/src/state/screen.ts`.
- Update `addTuiToast` and `addTuiToasts` to:
  - assign stable ids
  - dedupe exact active duplicates
  - refresh expiry on duplicate
  - retain only a bounded small history if needed for animation cleanup
- Add a single timer effect in `App` for the nearest active expiry. Avoid one timer per toast component.
- Render the toast in the root fixed layer, not inside `DashboardBody` or the scroll viewport.
- Keep `dismissToasts()` and add a narrower `expireToasts(now)` or `dismissToast(id)` store action.

Acceptance:

- Only one active toast is visible.
- Repeated identical command errors do not render multiple copies.
- Success/info toasts auto-dismiss.
- Error toasts live longer and then dismiss.
- Toast sheet does not cover the footer.

Tests:

```text
ToastOverlay renders a bordered sheet with title and message
ToastOverlay renders only the active/latest toast
ToastOverlay wraps or truncates within a narrow width
addTuiToast dedupes exact active duplicates and refreshes expiry
App shows rename success in the overlay and then dismisses it
App shows command failure once even if completion and event both report it
```

### Slice 2 - Observer Status Instead Of Socket Toast Spam

Primary files:

```text
apps/tui/src/state/store.ts
apps/tui/src/state/screen.ts
apps/tui/src/services/errors/errors.ts
apps/tui/src/App/App.tsx
apps/tui/src/components/Dashboard/Dashboard.tsx
apps/tui/src/App/__tests__/app-render.integration.test.tsx
apps/tui/src/App/__tests__/command-ux.integration.test.tsx
apps/tui/src/state/store.test.ts
```

Implementation:

- Add `observerConnectionStatus` to `TuiState`.
- On `loadSnapshot()` success, mark connected.
- On event stream success, mark connected.
- On snapshot or subscription connect failure:
  - if a snapshot exists, mark `displayOnly`
  - if no snapshot exists, keep loading and mark `reconnecting`
  - suppress the normal error toast for expected observer socket connection failures
- Continue surfacing non-connect protocol/request errors as normal error toasts.
- Render `observer reconnecting · display-only snapshot` in the top line when a snapshot exists.
- Render cold-start copy when no snapshot exists.
- On recovery after a visible disconnected interval, optionally add `Observer reconnected.` as a success toast.

Detection should start with known safe error codes rather than string matching full socket messages. Prefer codes like:

```text
PROTOCOL_CONNECT_FAILED
PROTOCOL_CONNECT_TIMEOUT
PROTOCOL_REQUEST_FAILED caused by connect failure, if the safe error preserves that boundary
```

If the current safe error loses the specific connect code before reaching the TUI, add a small TUI-local predicate around the safe error shape and test the current code path. Do not broaden contracts unless the current error mapping makes this impossible without brittle string matching.

Acceptance:

- Restarting the observer shows one calm status, not repeated socket-path toasts.
- The status clears after reconnect.
- Cold start without a snapshot says `waiting for observer`, not `display-only`.
- Actual command/action failures still show toast sheets.

Tests:

```text
store marks displayOnly when snapshot exists and observer reconnect fails
store marks reconnecting when no snapshot exists and observer connect fails
repeated reconnect failures do not append user-visible toasts
successful snapshot clears observer status
App renders display-only status in the header while keeping rows visible
App renders cold-start reconnect copy without raw socket path
```

### Slice 3 - Polish, Copy, And Manual Smoke

Implementation:

- Tune copy after dogfood:
  - `observer reconnecting`
  - `display-only snapshot`
  - `waiting for observer`
  - `Observer reconnected.`
- Tune lifetimes if errors disappear too fast or successes feel sticky.
- Decide whether manual dismissal needs a visible key. If needed, prefer dashboard-only uppercase `D:dismiss` while a toast is visible; do not steal lowercase row slots.
- Update `docs/tui.md` or the existing dashboard visual notes if the implementation settles the behavior.

Manual verification:

```text
pnpm wosm:tui-dev
restart the observer while the dashboard is open
confirm the dashboard remains visible with display-only status
confirm no repeated socket-path toasts appear
wait for observer reconnect and confirm status clears
trigger a rename success and confirm a small toast sheet appears and dismisses
trigger a command failure and confirm one error sheet appears
open a prompt/sheet while a toast is visible and confirm no overlap
resize the terminal narrow and confirm footer/toast/header remain coherent
```

## Layout Rules

- Toast overlay is a sibling to dashboard rendering under `TuiShell`.
- Toast overlay is not a child of `DashboardBody`.
- Toast overlay sits above:
  - footer divider
  - footer row
  - command prompt row, when present
- New-session and edit sheets take priority over toasts. If a modal sheet is open, either:
  - render the toast above the sheet if space allows, or
  - hide transient success/info toasts until the sheet closes.
- Help overlay and modal sheets remain stronger overlays than toasts.
- Observer status belongs in the top line, not in the toast overlay.

## Test Matrix

```text
Component:
  ToastOverlay empty state
  ToastOverlay success/info/error styles
  ToastOverlay details formatting
  ToastOverlay narrow width

State:
  add toast
  dedupe duplicate active toast
  replace with newer different toast
  expire toast
  observer connected -> displayOnly -> connected
  observer reconnecting without snapshot

App integration:
  rename success toast
  remove failure toast
  duplicate command failure stays one visible toast
  observer restart with snapshot shows display-only status
  cold start observer unavailable shows waiting copy
  prompt plus toast does not overlap footer
```

Focused commands:

```bash
pnpm exec vitest run apps/tui/src/components/ToastStack/ToastStack.test.tsx --config config/vitest/vitest.unit.config.ts
pnpm exec vitest run apps/tui/src/state --config config/vitest/vitest.unit.config.ts
pnpm exec vitest run apps/tui/src/App/__tests__/app-render.integration.test.tsx apps/tui/src/App/__tests__/command-ux.integration.test.tsx --config config/vitest/vitest.integration.config.ts
```

Before shipping:

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
```

Run `pnpm test:all` if the observer/protocol error-mapping path changes beyond TUI-local handling.

## Recommended PR Shape

PR 1:

```text
feat(tui): render toasts as a lifecycle overlay
```

Scope:

- one-toast overlay sheet
- toast dedupe/expiry
- existing action feedback still works
- no observer status rewrite yet

PR 2:

```text
fix(tui): show observer reconnecting as display-only status
```

Scope:

- observer connection status state
- suppress repeated socket connect toasts
- display-only/cold-start copy
- recovery feedback

PR 3, only if needed:

```text
docs(tui): document toast and observer status behavior
```

Scope:

- update living TUI docs after dogfood confirms the behavior
- add manual smoke notes if the flow becomes part of release verification

## Open Decisions

- Exact toast lifetimes after dogfood.
- Whether error toasts should be manually dismissible in the first implementation.
- Whether recovery feedback should always show or only after a visible reconnect delay.
- Whether `display-only snapshot` or `local snapshot` is clearer in real use. Recommendation: start with `display-only snapshot`; it describes capability without implying persistence ownership.

## UX Implication

Observer restarts stop looking like an error storm. The TUI remains calm: action feedback appears as a small overlay sheet, and daemon reconnects become a display-only status until fresh observer truth resumes.
