# TUI Dashboard Visual Notes

Draft date: 2026-05-27

Scope: visual direction, interaction model, and implementation-shape notes for the `apps/tui` dashboard. These are product/UI planning notes, not a contracts or protocol change.

## Priority Recommendations

These recommendations synthesize common patterns from mature TUIs such as LazyGit, K9s, Yazi, btop/htop, fzf, Textual, and Bubble Tea apps. The main lesson is that dense terminal apps scale best when layout regions, modes, and keybinding ownership are explicit before visual polish grows.

### P0: Required Before Implementation

- Define the fixed layout regions before building more row UI:
  - top bar
  - top scroll-indicator row
  - scrollable project/worktree viewport
  - bottom scroll-indicator row
  - footer
  - overlay layer
- Keep row slots viewport-aware. `0-9 a-z` must map only to currently visible rows after scroll, search, and project collapse. Hidden rows must never be targetable through stale slots.
- Decide and document that WOSM is slot-driven, not cursor-driven. Slots are visible-row accelerators; mouse clicks can activate visible rows; scrolling does not imply a selected hidden row.
- Treat help, prompts, confirmations, and future command palettes as overlay or mode layers. They must not reflow the dashboard body or consume project-row layout space.
- Define context-specific keybinding modes:
  - dashboard
  - search input
  - new-session input
  - remove confirmation
  - help overlay
  - command palette
- Document `Esc`, `Q`, `/`, `:`, `H`, `?`, `Enter`, `0-9`, `a-z`, and mouse behavior for each mode. Add `?` as a help alias even if the footer advertises `H:help`; terminal users commonly expect `?` or `F1` to reveal help.
- Add responsive truncation rules. Preserve row slot, state marker, branch identity, and action/status text first; drop or truncate secondary metadata before primary identity.
- Add fixed-height render tests for top divider, scroll-indicator rows, body clipping, overlay placement, and footer row. Layout behavior should be tested with exact terminal dimensions.

### P1: Needed For Scale

- Make the footer context-aware and short. It should show only high-frequency actions plus `H:help`; the help overlay carries the long list.
- Add a command palette plan. As user-defined commands grow from config, a searchable `:` command palette will scale better than assigning every action a visible footer key. Do not assign lowercase letters to global commands while `a-z` are visible-row slots.
- Add collapsed-project summaries for hidden important state. A collapsed project with active or attention rows should advertise that in the project header, for example:

```text
▶ observer - 8 worktrees | 1 working | 2 attention | opencode
```

- Keep action-projection work as a future follow-up. A later TUI action plan may support projections, rollback, timeout handling, and command/event correlation, but the new-session bottom-sheet PR intentionally does not implement that layer.
- Specify mouse behavior. The dashboard is mouse scrollable; row click activates/focuses; project-header click toggles collapse; footer/help clicks are optional later.
- Add top-widget rules. Widgets must be async, cached, bounded by width, optional, and unable to block startup, render, reconcile, or row interaction. Widgets should have priority/hide order under narrow widths.
- Add error and toast placement rules so prompts, toasts, and overlays cannot be clipped by the scroll viewport.

### P2: Polish And Extensibility

- Add glyph fallbacks for terminals/fonts that render Unicode poorly:
  - working: `*`
  - future projected pending: `+`
  - idle: `o`
  - attention: `!`
  - unknown: `?`
  - exited: `x`
  - no agent: `-`
  - pass: `ok`
  - fail: `xN`
- Consider a small details/inspector overlay later for row diagnostics, terminal provider details, stale metadata timestamps, and command history. Keep raw provider data out of the normal row.
- Keep attention static initially. If static alerts are missed in real E2E, pulse style on the same `!` before changing glyphs.
- Add config-driven help sections once custom commands exist. Built-in keybindings and configured commands should render in one help surface with stable grouping.

## Component Hierarchy

This is the target UI hierarchy implied by the mockups. Names are conceptual; implementation can reuse existing `apps/tui` components or rename them as long as the ownership and layout relationships stay clear.

Important distinction: overlay state and overlay rendering are separate concerns. Cross-cutting state should be modeled as providers that wrap the app, but the rendered overlay layer should be a root-level visual layer, sibling to the dashboard frame, not a child of the scroll viewport or dashboard body.

In this document, `Provider` means a React/Ink state provider. It does not mean a wosm integration provider such as Worktrunk, tmux, Codex, or OpenCode. To avoid that collision in implementation, prefer names such as `OverlayStateProvider`, `DashboardStateProvider`, and `KeymapProvider` for UI state.

```text
App
└─ TuiModeProvider
   └─ ObserverProvider
      └─ DashboardStateProvider
         ├─ SnapshotState
         ├─ CollapsedProjectState
         ├─ SearchState
         ├─ PromptState
         └─ ViewportProvider
            ├─ TerminalSize
            ├─ ScrollOffset
            ├─ VisibleRowRange
            ├─ VisibleRowSlotMap
            └─ KeymapProvider
                  ├─ ActiveMode
                  │  ├─ DashboardMode
                  │  ├─ SearchMode
                  │  ├─ NewSessionMode
                  │  ├─ RemoveConfirmMode
                  │  ├─ HelpMode
                  │  └─ CommandPaletteMode
                  ├─ KeyBindings
                  ├─ MouseBindings
                  └─ WidgetProvider
                     ├─ WidgetRegistry
                     ├─ WidgetDataCache
                     ├─ WidgetRenderPolicy
                     └─ TuiShell
                        ├─ DashboardFrame
                        │  ├─ TopBar
                        │  │  ├─ ProductTitle
                        │  │  │  └─ "wosm" | "wosm dev"
                        │  │  ├─ TopBarSpacer
                        │  │  └─ WidgetStrip
                        │  │     ├─ Widget(Time)
                        │  │     ├─ Widget(Weather)
                        │  │     ├─ Widget(Memory)
                        │  │     └─ Widget(Stock)
                        │  ├─ TopDivider
                        │  ├─ TopScrollIndicator
                        │  │  └─ HiddenRowsAbove | Blank
                        │  ├─ ScrollViewport
                        │  │  └─ DashboardBody
                        │  │     └─ ProjectList
                        │  │        └─ ProjectGroup[]
                        │  │           ├─ ProjectHeader
                        │  │           │  ├─ DisclosureMarker
                        │  │           │  ├─ ProjectName
                        │  │           │  ├─ ProjectSummary
                        │  │           │  │  ├─ WorktreeCount
                        │  │           │  │  ├─ WorkingCount
                        │  │           │  │  └─ AttentionCount
                        │  │           │  └─ DefaultHarnessLabel
                        │  │           ├─ WorktreeRow[]
                        │  │           │  ├─ RowSlot
                        │  │           │  ├─ RowStateMarker
                        │  │           │  │  ├─ AgentWorkingThrobber
                        │  │           │  │  ├─ OptimisticOperationThrobber
                        │  │           │  │  ├─ IdleMarker
                        │  │           │  │  ├─ AttentionMarker
                        │  │           │  │  └─ UnknownOrExitedMarker
                        │  │           │  ├─ RowPrimary
                        │  │           │  │  ├─ BranchName
                        │  │           │  │  ├─ HarnessLabel
                        │  │           │  │  └─ AgentStatusLabel
                        │  │           │  └─ RowMetadata
                        │  │           │     ├─ GitMetadata
                        │  │           │     │  ├─ LineDelta
                        │  │           │     │  ├─ PullRequestNumber
                        │  │           │     │  └─ CheckStatus
                        │  │           │     └─ WarningReason
                        │  │           └─ EmptyProjectState
                        │  ├─ BottomScrollIndicator
                        │  │  └─ HiddenRowsBelow | Blank
                        │  ├─ BottomDivider
                        │  └─ Footer
                        │     ├─ ContextualCommandHints
                        │     │  ├─ NewHint
                        │     │  ├─ SlotJumpHint
                        │     │  ├─ RemoveHint
                        │     │  ├─ SearchHint
                        │     │  ├─ RefreshHint
                        │     │  ├─ HelpHint
                        │     │  └─ QuitOrCloseHint
                        │     └─ FooterOverflowPolicy
                        └─ OverlayLayer
                           ├─ HelpOverlay
                           │  ├─ OverlayBackdrop
                           │  └─ HelpPanel
                           │     ├─ HelpTitle
                           │     ├─ BuiltInKeybindings
                           │     └─ ConfigKeybindings
                           ├─ SearchPromptOverlay
                           ├─ NewSessionBottomSheet
                           │  ├─ SheetBackdrop
                           │  ├─ QuickCreateReview
                           │  ├─ EditSessionName
                           │  ├─ ProjectPicker
                           │  └─ AgentPicker
                           ├─ RemoveConfirmOverlay
                           ├─ CommandPaletteOverlay
                           └─ ToastStack
```

### Relationship Notes

- Providers wrap the render tree and own cross-cutting state. Components consume providers through narrow hooks instead of receiving a single large controller object.
- `ObserverProvider` owns the socket-backed snapshot/event subscription and command dispatch boundary.
- `DashboardStateProvider` owns local UI state such as collapsed projects, search, and prompt state.
- `ViewportProvider` owns terminal size, scroll offset, visible row range, and `VisibleRowSlotMap`.
- `KeymapProvider` owns active input mode, keybindings, and mouse bindings.
- `WidgetProvider` owns widget registration, caches, and render priority. Widgets remain independent of observer reconcile unless a later action-projection layer gives them action awareness.
- `DashboardFrame` owns terminal geometry. It is responsible for reserving fixed rows and ensuring the footer hugs the bottom of the terminal.
- `ScrollViewport` is the only vertically scrolling dashboard region. Top bar, dividers, scroll indicators, footer, and overlays stay fixed.
- `TuiShell` is the root visual composition inside the full terminal frame. It renders `DashboardFrame` and `OverlayLayer` as siblings so overlays can sit above the dashboard without becoming part of the dashboard layout.
- `VisibleRowSlotMap` is derived from rows visible inside `ScrollViewport`; it must update after scroll, search, and collapse changes.
- `ProjectGroup` owns expand/collapse state display, but the actual collapsed project ids live in UI state so keyboard and mouse can update the same source of truth.
- `WorktreeRow` renders normalized snapshot data only. It should not call providers, inspect git, or query terminal details.
- `RowMetadata` is right-aligned and optional. It should disappear before `RowPrimary` when width is constrained.
- `OverlayLayer` is above all frame regions. Overlays never consume rows inside `ScrollViewport`.
- `NewSessionBottomSheet` is an overlay, not a dashboard child. It may cover the lower dashboard and footer while open, and it owns its own mode-specific key hints.
- `Footer` reads the active keymap mode. It should not duplicate every binding when `HelpOverlay` can show the full list.
- Action projections, rollback, timeout handling, and command/event correlation are future work. This new-session PR intentionally relies on command toasts and observer snapshots instead of a global orchestration layer.

### Overlay Implementation Plan

Start with help as the first overlay and use it to establish the reusable shape for prompts, confirmations, command palette, and toasts.

Recommended first slice:

1. Extend local UI state with an overlay/mode value for help, keeping it separate from observer snapshot state.
2. Update input handling so `H` or `?` opens help from dashboard mode, and `H`, `?`, `Q`, or `Esc` closes it from help mode.
3. Introduce a root-level `TuiShell` that renders `DashboardFrame` plus `OverlayLayer` inside the existing full-size `TuiFrame`.
4. Render `HelpOverlay` from `OverlayLayer`, not as `Dashboard` children and not inside `DashboardBody`.
5. Move `CommandPrompt` and `ToastStack` toward `OverlayLayer` after help proves the root layer works, so prompt/toast placement cannot be clipped by the scroll viewport.
6. Add fixed-height render tests that prove opening help does not move the header, scroll rows, body, dividers, or footer.

The help overlay is a TUI concern. It must not call worktree, terminal, or harness providers. It can read keymap/help definitions from local UI state and, later, from config-derived command metadata already exposed to the TUI.

## Future Action Projections

This PR does not add a global TUI orchestration or optimistic projection layer. New-session submit closes the sheet, dispatches `session.create`, shows the existing queued/error toast from command dispatch, and waits for observer snapshot truth to render the real row.

A later TUI action plan may add projections, rollback, timeout handling, and command/event correlation for slow create, start, remove, or refresh operations. If that happens, keep the layer shared and renderless: it should dispatch typed observer commands, own only local action state, and let rows, overlays, footer hints, and widgets decide how to react.

Future projection rules to revisit:

- Reconcile or events must win over local projections.
- Non-actionable create/remove placeholders must not receive visible row slots.
- Rollback must affect only the projected action associated with the failed command.
- Timeouts must be explicit and visible instead of leaving stale pending UI.

### Toast Rules

- Toasts are for action acknowledgement, failures, and non-blocking completion notes.
- Toasts must render outside the scroll viewport so they cannot be clipped by row overflow.
- Future projections may be useful for persistent multi-second action progress, but this PR only uses command queued/error toasts.
- Error toasts should include the user-facing command target when available, such as branch name or project.

## Current Direction

- Keep the top line minimal: `wosm` or `wosm dev` on the left, configurable widgets on the right.
- Draw a divider immediately below the top line with no blank line.
- Draw a divider immediately above the help footer.
- Reserve one scroll-indicator row below the top divider and one above the footer divider. These rows can be blank when all content fits.
- Project headers use fat disclosure arrows:
  - `▼` expanded
  - `▶` collapsed
- Project headers use a dash between project name and summary: `▼ wosm - 3 worktrees | codex`.
- Worktree rows are indented one space so the project header owns the left edge.
- Worktree rows keep row slot, state marker, branch, harness, and agent status on the left.
- Row slots are assigned only to visible rows that currently have an actionable focus/start target.
- Git metadata is right-aligned as a fixed suffix: diff summary, PR number, and aggregate check status. The left side truncates first so the metadata suffix stays flush to the terminal edge.
- Future action projections can define separate pending rows or patches, but the current new-session PR does not render local projected rows.
- Do not print the terminal provider on every row by default. Surface terminal details only when they are actionable or diagnostic.
- Command keybinds render as capital letters in the TUI where applicable: `N`, `X`, `R`, `H`, `Q`.
- Row jump slots use `0-9 a-z`. Lowercase letters are reserved for visible row slots, not command labels.
- Footer help should use `N:new`, not `N:new bg`.
- Footer includes `H:help`. Help opens a centered overlay in front of the dashboard.

## Keybinding Mode Notes

- Dashboard mode: `0-9 a-z` activates the visible row slot; `N`, `X`, `/`, `:`, `R`, `H`, `?`, and `Q` run global dashboard actions. `Enter` has no hidden cursor-selection behavior unless a future visible focus affordance is added.
- Search input mode: text edits the query; `Enter` confirms the current result/filter; `Esc` returns to dashboard mode.
- New-session sheet mode: `Enter` creates, `E` edits the generated name, `P` changes project, `A` changes agent, and `Esc` cancels the sheet.
- Edit-session-name mode: text edits the requested session name; `Enter` uses the typed name or generated fallback; `Esc` returns to the new-session sheet without canceling the whole flow.
- Remove confirmation mode: `Enter` confirms the visible remove action; `Esc` cancels.
- Help overlay mode: `H`, `?`, `Q`, or `Esc` closes help. `Enter` is ignored unless the help overlay later gains focusable controls.
- Command palette mode: text filters commands; `Enter` runs the highlighted command; `Esc` closes the palette.

## New Session Bottom Sheet

The primary create path should feel like a "new thread" flow: fast by default, with naming and agent selection available only when the user wants them. Product copy should use `Session`, `Name`, and `Agent`. Internally, the chosen name still maps to the created worktree/branch name and `Agent` maps to the harness provider.

The generated name is valid as-is. Do not label it with literal `auto:` in the UI; render the generated value dimly to imply a default/hint. If the user opens the edit-name state with no typed input, place the cursor before the dim generated fallback so the field reads as "type here, or press Enter to use this generated name."

### Quick Create Review

Opened by `N`. The bottom sheet overlays the lower dashboard and replaces the normal footer while open. The dashboard behind it stays visible but inactive.

```text
wosm dev
────────────────────────────────────────────────────────────────────


▼ wosm - 6 sessions | codex
 [1] ○ ci-and-docs           +0/-0     #13  ✓  codex  idle
 [2] ○ pi-planning        +4258/-375   #16  ✓  codex  idle
 [3] ○ tmux-popup-persist    +0/-0     #1   ✓  codex  idle
 [4] ○ tui-help-overlay      +0/-0     #14  ✓  codex  idle
 [5] ○ tui-row-foundation    +0/-0     #15  ✓  codex  idle
 [6] ○ tui-UI-2              +0/-0     #12  ✓  codex  idle


╭────────────────────────────── New Session ─────────────────────────────╮
│ Project   wosm                                                          │
│ Name      wosm-k7p3x9                                                    │
│ Agent     codex                                                         │
│                                                                         │
│ Enter:create                                                            │
│ E:edit name   P:project   A:agent   Esc:cancel                          │
╰─────────────────────────────────────────────────────────────────────────╯
```

Rendering notes:

- `wosm-k7p3x9` is dim while it is generated and unedited.
- `Enter` creates immediately with the generated name.
- `Esc` cancels the whole new-session flow from this parent sheet.
- `P` and `A` can open picker states inside the same bottom-sheet surface.

### Edit Name Empty State

Opened by `E`. The field is empty, but the generated fallback remains visible as dim hint text. The cursor sits before the dim fallback.

```text
wosm dev
────────────────────────────────────────────────────────────────────


▼ wosm - 6 sessions | codex
 [1] ○ ci-and-docs           +0/-0     #13  ✓  codex  idle
 [2] ○ pi-planning        +4258/-375   #16  ✓  codex  idle
 [3] ○ tmux-popup-persist    +0/-0     #1   ✓  codex  idle
 [4] ○ tui-help-overlay      +0/-0     #14  ✓  codex  idle
 [5] ○ tui-row-foundation    +0/-0     #15  ✓  codex  idle
 [6] ○ tui-UI-2              +0/-0     #12  ✓  codex  idle


╭────────────────────────── Edit Session Name ───────────────────────────╮
│ Project   wosm                                                          │
│                                                                         │
│ Name      _wosm-k7p3x9                                                   │
│                                                                         │
│ Enter:use generated name   Esc:back                                      │
╰─────────────────────────────────────────────────────────────────────────╯
```

Rendering notes:

- The underscore marks cursor position in the mockup, not literal text.
- The generated fallback after the cursor is dim.
- `Enter` with no typed input accepts the generated fallback.
- `Esc` returns to `QuickCreateReview`; it does not cancel the whole flow.

### Edit Name Typed State

Once the user types, hide the generated fallback and render the typed value normally.

```text
wosm dev
────────────────────────────────────────────────────────────────────


▼ wosm - 6 sessions | codex
 [1] ○ ci-and-docs           +0/-0     #13  ✓  codex  idle
 [2] ○ pi-planning        +4258/-375   #16  ✓  codex  idle
 [3] ○ tmux-popup-persist    +0/-0     #1   ✓  codex  idle
 [4] ○ tui-help-overlay      +0/-0     #14  ✓  codex  idle
 [5] ○ tui-row-foundation    +0/-0     #15  ✓  codex  idle
 [6] ○ tui-UI-2              +0/-0     #12  ✓  codex  idle


╭────────────────────────── Edit Session Name ───────────────────────────╮
│ Project   wosm                                                          │
│                                                                         │
│ Name      fix-popup-close_                                               │
│                                                                         │
│ Enter:use name   Esc:back                                                │
╰─────────────────────────────────────────────────────────────────────────╯
```

After `Enter`, return to `QuickCreateReview` with the chosen name rendered normally, not dim.

```text
╭────────────────────────────── New Session ─────────────────────────────╮
│ Project   wosm                                                          │
│ Name      fix-popup-close                                                │
│ Agent     codex                                                         │
│                                                                         │
│ Enter:create                                                            │
│ E:edit name   P:project   A:agent   Esc:cancel                          │
╰─────────────────────────────────────────────────────────────────────────╯
```

### Create Feedback

After submit, close the sheet and dispatch `session.create`. The existing command-dispatch feedback handles immediate response:

- accepted receipt: show the queued toast
- rejected receipt or dispatch error: show the safe error toast

The dashboard does not render a local placeholder row in this PR. It waits for observer snapshot/event truth before showing the new worktree/session row.

```text
▼ wosm - 6 sessions | codex
 [1] ○ ci-and-docs           +0/-0     #13  ✓  codex  idle
 [2] ○ pi-planning        +4258/-375   #16  ✓  codex  idle
 [3] ○ tmux-popup-persist    +0/-0     #1   ✓  codex  idle
 [4] ○ tui-help-overlay      +0/-0     #14  ✓  codex  idle
 [5] ○ tui-row-foundation    +0/-0     #15  ✓  codex  idle
 [6] ○ tui-UI-2              +0/-0     #12  ✓  codex  idle

toast: session.create queued
```

When the observer snapshot confirms the session/worktree exists and is actionable, render snapshot truth and assign a visible row slot.

```text
 [7] ○ fix-popup-close       +0/-0     -    -  codex  idle
```

## Status Markers

Working rows should use a single-cell arc throbber instead of `*`.

Preferred working throbber frames:

```text
◜ ◠ ◝ ◞ ◡ ◟
```

Static mockups can show one frame:

```text
 [0] ◜ pr-info-1             codex  working               +0/-0  #11  ✓
```

Future action projections should use a separate throbber family for WOSM/worktree operations such as starting, stopping, creating, removing, or refreshing worktree state. These operations can legitimately take a few seconds in large projects and should visibly acknowledge the user's action before provider truth catches up. The current new-session PR does not render these projected operation rows.

Preferred future-operation throbber frames:

```text
⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
```

The distinction is:

```text
◜  agent/harness is actively working
⠋  WOSM/provider operation is pending as a future projection
```

For temporary operations expected to resolve quickly, make the row intentionally lighter by removing secondary metadata:

```text
 [7] ⠋ tui-UI-1              starting agent...
 [ ] ⠙ payment-refactor      creating worktree...
 [ ] ⠹ old-experiment        removing worktree...
```

This would demonstrate responsiveness without showing stale or irrelevant PR/check data during a transition. Long-running `working` rows should keep the full row because the user may need branch, harness, PR, and check context while work continues.

## Other Row Markers

Use distinct row-state markers so left-side row state does not blur with right-side check status:

```text
?   unknown or stale status
×   agent/session exited
-   no current agent/session
```

Fallbacks for limited terminals are listed in the glyph fallback section. Failed checks remain right-side metadata such as `x1` or `x2`; they are not row-state markers.

## Top Row Widgets

The top row should avoid repeating dashboard counts. It should reserve the left side for the product label and the right side for configurable widgets.

Initial widget examples:

```text
10:42 AM
MEM 68%
AAPL 196.24 +0.8%
72°F
```

Widgets are optional and should be compact. They should not push the product label off screen.

## Idle Marker Options

Idle rows should stay static. Motion is reserved for active work and, possibly later, attention.

Candidate single-cell idle markers:

```text
.   current plain marker; safe, but punctuation-like
·   quieter dot; intentional without adding weight
◦   small hollow circle; calm, but can be faint
○   hollow circle; more visible, but competes with status glyphs
∙   bullet operator; denser than ·, less common
-   very quiet, but already useful for no-agent/missing state
    blank marker; cleanest, but weakens row-state scanning
```

Decision: use `○` for idle rows. It is more visible than the small dot markers while staying calm and static. Avoid animating idle rows.

## Check Status

Use aggregate check status instead of `ci:pass`.

Examples:

```text
✓   all checks pass
x2  two checks failed
…   checks running or pending
-   no check data
```

## Example Layout

```text
wosm dev                                                10:42 AM  72°F  MEM 68%
────────────────────────────────────────────────────────────────────────────────

▼ wosm - 7 worktrees | codex
 [0] ◜ pr-info-1             codex    working             +0/-0  #11  ✓
 [1] ○ tmux-popup-persist    codex    idle                +0/-0  #1   ✓
 [2] ○ tui-UI-1              codex    idle                +0/-0  #7   ✓
 [3] ! hook-scope            codex    needs attention     +8/-2  #12  x2
 [4] ! popup-latency         codex    stuck             +120/-44 #13  …
 [5] ? metadata-refresh      codex    unknown             +3/-1  #10  -
 [6] ⠋ auth-retry            starting agent...

▶ observer - 2 worktrees | opencode

▼ scripts - 3 worktrees | opencode
 [7] × batch-export          opencode exited              +0/-0  #8   ✓
 [8] ○ api-cache             opencode idle               +14/-6  #5   x1
 [ ] ⠙ old-experiment        removing worktree...

▼ empty-project - 0 worktrees | codex
  0 worktrees



 
────────────────────────────────────────────────────────────────────────────────
N:new 0-9 a-z:start/focus X:remove /:search R:refresh H:help Q/esc:close
```

The blank line under the top divider and the blank line above the footer divider are reserved scroll-indicator rows.

## Scrollable Layout

The dashboard body is mouse scrollable. When projects/worktrees exceed the terminal height, preserve the same top and footer frame and use the reserved rows to show whether content exists above or below the current viewport.

Mid-scroll example:

```text
wosm dev                                                10:42 AM  72°F  MEM 68%
────────────────────────────────────────────────────────────────────────────────
↑ 6 rows above
▼ wosm - 12 worktrees | codex
 [0] ○ tui-UI-1              codex    idle                +0/-0  #7   ✓
 [1] ! hook-scope            codex    needs attention     +8/-2  #12  x2
 [2] ! popup-latency         codex    stuck             +120/-44 #13  …
 [3] ? metadata-refresh      codex    unknown             +3/-1  #10  -

▼ observer - 8 worktrees | opencode
 [4] ⠋ reconcile-cache       starting agent...
 [5] ○ trace-bundle          opencode idle                +1/-1  #4   ✓
 [6] ! sqlite-cleanup        opencode needs attention    +19/-2  #6   x1
 [7] ◜ provider-hooks        opencode working            +32/-8  #16  …
 [ ] ⠙ stale-target-fix      removing worktree...
↓ 14 rows below
────────────────────────────────────────────────────────────────────────────────
N:new 0-9 a-z:start/focus X:remove /:search R:refresh H:help Q/esc:close
```

At the top of the scroll range, the upper indicator row is blank and the lower row shows hidden content below. At the bottom, the upper row shows hidden content above and the lower row is blank. If all content fits, both rows stay blank.

## Help Overlay

Pressing `H` opens a centered overlay in front of the regular dashboard content. The dashboard must not reflow, split, or reserve layout rows for the panel. The help overlay should use a full-screen backdrop layer, dim the dashboard where supported, and draw an opaque centered panel over it. The help content starts with built-in keybindings and should later be sourced from config so user-defined commands can appear in the same surface.

Panel content:

```text
┌──────────────────────────────────────────┐
│ Help                                     │
├──────────────────────────────────────────┤
│ 0-9 a-z  start or focus visible row      │
│ N        new worktree/session            │
│ X        remove worktree                 │
│ /        search                          │
│ :        command palette                 │
│ R        refresh                         │
│ Enter    confirm prompt or dialog        │
│ H / ?    close help                      │
│ Q / esc  close popup or quit TUI         │
└──────────────────────────────────────────┘
```

This is intentionally not a composited mockup. Implementation should render this panel centered above the dashboard with overlay semantics.

## Attention Marker Options

The default attention marker can stay `!` if clarity is more important than motion.

If attention should throb, prefer pulsing style over changing glyphs:

- Frame 1: dim red `!`
- Frame 2: red `!`
- Frame 3: bold red `!`
- Frame 4: red `!`

This keeps the marker single-width and easy to scan, but terminal support is limited to standard intensity/style, not true font weight. In Ink terms, this likely means cycling `dimColor`, normal color, and `bold`.

Glyph-changing attention options are possible but risk visual noise:

```text
! ! !      same glyph, style pulse
! ‼ !      stronger pulse, but width can vary by terminal
▲ △ ▲      alert triangle pulse, less semantically direct than !
```

Recommendation for now: animate only active `working` rows with the arc throbber, keep attention as a stable red/bold `!`, and revisit pulsing attention only if static alerts are too easy to miss.

## Research Inputs

- LazyGit: compact footer actions, discoverable keybindings, and custom commands with descriptions/loading text.
- K9s: context-specific hotkeys, command mode, plugins, and scalable help conventions.
- Yazi: layered keymaps for manager, input, confirm, completion, and help states.
- btop/htop: mouse support, function-key/help conventions, and dense status presentation.
- fzf: composable keybindings, preview panes, reload actions, and mouse support.
- Textual: explicit terminal layout regions, modal screens, footers, and command palette patterns.
- Bubble Tea/Bubbles: scrollable viewport and mouse-wheel model for terminal apps.

References:

- https://lazygit.dev/keybindings/
- https://lazygit.dev/docs/configuration/
- https://github.com/derailed/k9s/blob/master/README.md
- https://yazi-rs.github.io/docs/configuration/keymap/
- https://textual.textualize.io/how-to/design-a-layout/
- https://textual.textualize.io/guide/screens/
- https://pkg.go.dev/github.com/charmbracelet/bubbles/viewport
- https://learn.microsoft.com/en-us/previous-versions/windows/desktop/dnacc/guidelines-for-keyboard-user-interface-design
