# TUI Dashboard Visual Notes

Draft date: 2026-05-27

Scope: visual direction for the `apps/tui` dashboard row layout. These are product/UI notes, not a contract change.

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
- Git metadata is right-aligned: diff summary, PR number, and aggregate check status.
- Temporary WOSM/worktree operations can omit the right-side metadata block while showing an optimistic pending row.
- Do not print the terminal provider on every row by default. Surface terminal details only when they are actionable or diagnostic.
- Footer help should use `n:new`, not `n:new bg`.
- Footer includes `h:help`. Help opens a centered overlay in front of the dashboard.

## Status Markers

Working rows should use a single-cell arc throbber instead of `*`.

Preferred working throbber frames:

```text
◜ ◠ ◝ ◞ ◡ ◟
```

Static mockups can show one frame:

```text
 [1] ◜ pr-info-1             codex  working               +0/-0  #11  ✓
```

Use a separate throbber family for optimistic WOSM/worktree operations such as starting, stopping, creating, removing, or refreshing worktree state. These operations can legitimately take a few seconds in large projects and should visibly acknowledge the user's action before provider truth catches up.

Preferred optimistic-operation throbber frames:

```text
⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
```

The distinction is:

```text
◜  agent/harness is actively working
⠋  WOSM/provider operation is pending optimistically
```

For temporary operations expected to resolve quickly, make the row intentionally lighter by removing secondary metadata:

```text
 [7] ⠋ new-login-flow        starting agent...
 [ ] ⠙ payment-refactor      creating worktree...
 [ ] ⠹ old-experiment        removing worktree...
```

This demonstrates responsiveness without showing stale or irrelevant PR/check data during a transition. Long-running `working` rows should keep the full row because the user may need branch, harness, PR, and check context while work continues.

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
 [1] ◜ pr-info-1             codex    working             +0/-0  #11  ✓
 [2] ○ tmux-popup-persist    codex    idle                +0/-0  #1   ✓
 [3] ○ tui-UI-1              codex    idle                +0/-0  #7   ✓
 [4] ! hook-scope            codex    needs attention     +8/-2  #12  x2
 [5] ! popup-latency         codex    stuck             +120/-44 #13  …
 [6] ? metadata-refresh      codex    unknown             +3/-1  #10  -
 [7] ⠋ new-login-flow        starting agent...

▶ observer - 2 worktrees | opencode

▼ scripts - 2 worktrees | opencode
 [8] x batch-export          opencode exited              +0/-0  #8   ✓
 [9] ○ api-cache             opencode idle               +14/-6  #5   x1
 [ ] ⠙ old-experiment        removing worktree...

▼ empty-project - 0 worktrees | codex
  0 worktrees



 
────────────────────────────────────────────────────────────────────────────────
n:new 1-9:start/focus x:remove /:search r:refresh h:help q/esc:close
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
 [3] ○ tui-UI-1              codex    idle                +0/-0  #7   ✓
 [4] ! hook-scope            codex    needs attention     +8/-2  #12  x2
 [5] ! popup-latency         codex    stuck             +120/-44 #13  …
 [6] ? metadata-refresh      codex    unknown             +3/-1  #10  -

▼ observer - 8 worktrees | opencode
 [7] ⠋ reconcile-cache       starting agent...
 [8] ○ trace-bundle          opencode idle                +1/-1  #4   ✓
 [9] ! sqlite-cleanup        opencode needs attention    +19/-2  #6   x1
 [ ] ⠙ stale-target-fix      removing worktree...
↓ 14 rows below
────────────────────────────────────────────────────────────────────────────────
n:new 1-9:start/focus x:remove /:search r:refresh h:help q/esc:close
```

At the top of the scroll range, the upper indicator row is blank and the lower row shows hidden content below. At the bottom, the upper row shows hidden content above and the lower row is blank. If all content fits, both rows stay blank.

## Help Overlay

Pressing `h` opens a centered overlay in front of the regular dashboard content. The dashboard must not reflow, split, or reserve layout rows for the panel. The help overlay should use a full-screen backdrop layer, dim the dashboard where supported, and draw an opaque centered panel over it. The help content starts with built-in keybindings and should later be sourced from config so user-defined commands can appear in the same surface.

Panel content:

```text
┌──────────────────────────────────────────┐
│ Help                                     │
├──────────────────────────────────────────┤
│ n        new worktree/session            │
│ 1-9      start or focus visible row      │
│ x        remove worktree                 │
│ /        search                          │
│ r        refresh                         │
│ h        close help                      │
│ q / esc  close popup or quit TUI         │
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
