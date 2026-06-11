# WOSM Station Spike - Goals And Non-Goals

Status: active spike plan
Date: 2026-06-10

## Spike Purpose

Prove whether WOSM should have a full-screen workspace mode that owns panes,
mouse focus, and WOSM-aware actions while still running real terminal processes
inside those panes.

Station mode should answer one business/product question:

> Can WOSM become approachable for users who do not want to learn tmux, while
> preserving the terminal-native power that makes WOSM valuable?

This is a spike, not a rewrite commitment.

## Primary Goals

### 1. Create An Isolated Station Spike

Create Station first as an isolated experiment:

- experiment root: `experimental/station`
- spike package/app: `experimental/station/apps/station`
- package name: `@wosm/station`
- CLI command: `wosm station`
- user-facing mode label: `station mode`
- planning doc: `docs/planning/active/wosm_station_spike.md`

The production promotion target is still a real top-level app:

- package/app: `apps/station`

Do not promote Station into the root workspace until the spike proves the UX,
the renderer/runtime stack, and the packaging story. The spike should be
isolated enough that it does not destabilize existing `apps/cli`, `apps/tui`,
or tmux/classic workflows.

Recommended initial shape:

```text
experimental/
  README.md
  station/
    README.md
    package.json
    bun.lock
    pnpm-lock.yaml
    .devcontainer/
      devcontainer.json
      Dockerfile
    scripts/
      doctor.sh
      run-container.sh
      run-host.sh
    apps/
      station/
        package.json
        src/
          app/
          components/
            frame/
            panes/
            overlays/
            ui/
          commands/
          input/
          providers/
          runtime/
          state/
          terminal/
          theme/
    packages/
```

Only include lockfiles that are actually used by the chosen spike lane. For
example, keep `bun.lock` only if the OpenTUI/Bun path is active, and keep a
local `pnpm-lock.yaml` only if the Node 26 path is active. These lockfiles must
stay under `experimental/station`, not at the repository root.

Do not add `experimental/**` to the root `pnpm-workspace.yaml` during the
spike. Root `pnpm install`, `pnpm build`, `pnpm lint`, and `pnpm test:all` must
not install, build, lint, or test Station unless Station has been explicitly
promoted.

### 2. Prove A WOSM-Owned Full-Screen Workspace

Station should launch into a full-screen terminal UI that owns:

- screen layout
- header / command controls
- pane tree
- pane borders
- active-pane focus
- mouse click focus
- keyboard input routing
- resize handling

The user should feel like they have entered a WOSM-controlled workspace, not a
tmux popup and not a generic shell wrapper.

### 3. Run Real Terminal Processes Inside Panes

Station panes should run real PTY-backed terminal processes such as:

- `zsh`
- `bash`
- `codex`
- `opencode`
- `difftastic`
- `git diff`
- `pnpm test`
- simple long-running commands

The spike should prove that WOSM can host existing terminal tools instead of
rebuilding their functionality.

Minimum proof:

- spawn one shell in a pane
- type into it
- run commands
- stream output correctly
- handle Ctrl-C
- handle resize
- close the pane cleanly

### 4. Prove Basic Pane Layout

Station should support the minimum pane operations needed to feel like a real
workspace:

- split right
- split below
- focus next pane
- click pane to focus
- close pane
- resize terminal window and preserve sane layout

Nice-to-have, but not required for the spike:

- drag-resize pane borders
- tabs
- multiple workspaces
- pane zoom
- pane move/reorder

The spike succeeds if split/focus/close feels boring and reliable.

### 5. Show WOSM State Beside Real Panes

Station should read observer snapshots and display useful WOSM context near the
workspace.

Minimum useful state:

- current project
- known sessions
- active worktrees
- agent/session status if available
- selected session/worktree metadata

This does not need to be beautiful yet. It only needs to prove that Station is
more than a generic terminal multiplexer.

The core product idea to validate:

> Panes are generic terminals, but the workspace understands WOSM projects,
> worktrees, agents, and sessions.

### 6. Prove WOSM-Aware Actions

Station should include a few clickable or keyboard-triggered actions that make
the workspace feel product-specific.

Minimum actions:

- open shell in current project root
- open shell in selected worktree
- open agent command in a pane
- open diff command in a pane
- jump/focus selected pane
- close pane

Example command buttons:

- `+ shell`
- `+ agent`
- `split`
- `diff`
- `test`
- `close`

The important thing is not the exact UI. The important thing is proving that
WOSM can create useful terminal panes from project/session context.

### 7. Prove The Difftastic-Style Workflow

This is a key philosophical test.

Station should show that WOSM does not need to rebuild diff UI. It can open a
real terminal diff tool inside a pane.

Minimum demo:

1. Select a project/worktree/session.
2. Click or trigger `diff`.
3. Station opens a pane.
4. The pane runs a real diff command, ideally `difftastic` or a fallback
   `git diff`.
5. The user can focus, scroll, close, or split beside that diff pane.

This proves the core Station principle:

> WOSM owns the workspace frame. Terminal tools still do the work.

### 8. Keep Classic/Tmux Mode Intact

Station must not break the existing workflow.

Existing behavior should continue:

- `wosm`
- `wosm doctor`
- `wosm snapshot`
- `wosm reconcile`
- `wosm popup`
- tmux/classic flow
- existing observer protocol
- existing integrations

Station is additive.

The spike is allowed to be rough. The existing WOSM workflow should remain the
stable path.

### 9. Keep Station Client-Local For The Spike

For the first spike, Station can own its own local runtime:

- `StationRuntime`
- `PaneTree`
- `PtyRegistry`
- `TerminalBuffer`
- `MouseFocusController`
- `ObserverSnapshotClient`

It can spawn processes directly.

It does not need to become a normalized terminal provider yet.

The goal is to prove UX and technical feel before committing to observer-level
terminal-provider contracts.

### 10. Produce A Demoable Workflow

The spike should end with a short demo that can be shown to users/investors.

Target demo:

1. Run `wosm station`.
2. Select/open a project.
3. Spawn a shell pane.
4. Split right.
5. Spawn an agent pane.
6. Split below.
7. Open a diff pane using a real diff command.
8. Click between panes.
9. Show WOSM project/session state beside panes.
10. Close panes cleanly.

The demo should make the product direction obvious within 60 seconds.

## Prerequisite: Shared Client Runtime

Observer-connected Station work depends on
[`packages/client`](client_package_observer_runtime_plan.md).

Station can continue to prototype local layout, input routing, and fake panes
inside `experimental/station` before that package exists. However, Station
should not grow a Station-specific observer connector for the WOSM overlay.
Live observer snapshots, event subscriptions, reconnect behavior, command
dispatch, and command completion should come from the shared rich-client runtime
planned in `packages/client`.

The goal is for Station to share the same observer-consumption boundary as
`apps/tui` while keeping Station-specific concerns local:

- Station owns frame/header/panes/overlays/input/PTY runtime.
- `packages/client` owns rich-client synchronization with observer truth.
- `packages/protocol` owns low-level socket transport and message validation.
- `packages/contracts` owns shared schemas and types.

## Current Design Direction

These notes capture the current working organization for the two-mode Station
design. They are design direction for the spike, not final product architecture.
Change them when running code proves a better shape.

### Two Primary Modes

Station should start with two visible modes.

Session mode is the normal workspace. It owns the header, tab strip, WOSM
dynamic island, pane grid, pane focus, and real terminal processes. In the
current sketch, Codex runs in the large left agent pane while app/dev-server and
database terminals run in right-side panes. Those exact pane roles are examples,
not fixed product slots.

WOSM mode is selected from the WOSM dynamic island in the header. It should be
implemented as an overlay above the session workspace, not as a route that
destroys or replaces the pane layout. Underlying panes keep running. Input routes
to the WOSM overlay while it is active. Closing the overlay restores focus to the
previous pane or header target.

Use normal UI terms:

- `frame`: the outer structural layout for the Station app
- `header`: the top row that contains tabs, title/metadata, and the WOSM dynamic
  island
- `pane`: a Station workspace region that can host a terminal process
- `overlay`: WOSM mode, dialogs, command palette, and similar temporary layers

Avoid the term `chrome` in Station planning and code unless a third-party API
forces it. It is too vague for this app. Avoid `shell` for the outer app frame
because it collides with real Unix shells running inside panes.

### State Shape

Use one canonical coordination store for cross-app state, but do not turn it
into a universal data sink.

The coordination store should own normalized state that multiple parts of
Station must agree on:

- active mode and active overlay
- header tabs/windows
- pane layout and pane metadata
- active focus target
- command lifecycle metadata
- observer snapshot-derived WOSM graph summaries
- selected project/worktree/session ids

The coordination store should not own high-frequency or non-serializable runtime
objects:

- terminal scrollback buffers
- every PTY output chunk
- raw ANSI frame data
- process handles
- OpenTUI renderer refs
- terminal backend refs

Those belong in provider-backed runtime registries, with the store holding stable
ids and metadata.

Keep truly local interaction state local when it does not need to survive mode
changes, reconnects, or external events. Examples: hover state, an unsubmitted
text field draft, and temporary resize-drag measurements.

### Providers

Provider language is acceptable in Station code. In this context, providers are
React/OpenTUI capability providers, not WOSM integration providers such as
Worktrunk, tmux, Codex, or OpenCode.

Use providers for shared capabilities and services:

- `CommandProvider`
- `KeymapProvider`
- `DialogProvider`
- `ToastProvider`
- `ThemeProvider`
- `TerminalBackendProvider`
- `WosmClientProvider`
- `ClipboardProvider`

Avoid domain mini-database providers such as `SessionProvider`, `PaneProvider`,
`TerminalProvider`, `AgentProvider`, `WorktreeProvider`, `WosmProvider`,
`TabProvider`, `LayoutProvider`, `HeaderProvider`, or
`DynamicIslandProvider`. Those concerns should usually be store slices,
selectors, components, or runtime registries.

### Input Routing

Input routing is the central design problem. Do not let individual components
each decide globally important key behavior.

Station should route keyboard and mouse input through one input router that
understands focus, mode, overlays, and terminal passthrough.

Focus should be pane-oriented. Terminals are content attached to panes, not a
separate competing focus layer.

```ts
type FocusTarget =
  | { kind: "header"; region: "tabs" | "island" | "title" }
  | { kind: "pane"; paneId: PaneId }
  | { kind: "overlay"; overlayId: OverlayId }
  | { kind: "dialog"; dialogId: DialogId };
```

Use a keymap stack rather than a long chain of component-specific conditionals.
The current intended priority is:

1. resize drag
2. dialog
3. command palette
4. WOSM overlay
5. terminal passthrough
6. session workspace
7. base

The router should return explicit outcomes, for example:

- handled app command
- write bytes to focused terminal pane
- focus change
- open overlay
- close overlay
- ignored

Reserved WOSM chords should remain available even when a terminal pane is
focused. Most ordinary text input should pass through to the focused terminal
process.

### Working Domains

Keep these domains separate from the beginning:

- `workspace`: tabs/windows, pane layout, active workspace, focusable surfaces
- `wosmGraph`: observer snapshot summaries, selected WOSM project/worktree/session
- `terminal`: terminal ids, backend attachment, resize, write, kill, process role
- `agent`: harness identity, status, hook-derived state, launch commands
- `worktree`: project path, branch, dirty state, Worktrunk identity
- `commands`: command registry, palette entries, keybinding targets
- `input`: key routing, mouse routing, focus, overlay/modal stack

### Proposed Source Layout

The current proposed spike layout is:

```text
experimental/station/apps/station/src/
  app/
    StationApp.tsx
  components/
    frame/
      StationFrame.tsx
      Header.tsx
      TabStrip.tsx
      DynamicIsland.tsx
    panes/
      PaneGrid.tsx
      PaneFrame.tsx
      TerminalPane.tsx
    overlays/
      WosmOverlay.tsx
      CommandPalette.tsx
      DialogHost.tsx
    ui/
      Button.tsx
      Divider.tsx
      FocusRing.tsx
      IconButton.tsx
      Surface.tsx
      TextInput.tsx
      Toast.tsx
  commands/
    registry.ts
  input/
    focus.ts
    keymaps.ts
    router.ts
  providers/
    ClipboardProvider.tsx
    CommandProvider.tsx
    DialogProvider.tsx
    KeymapProvider.tsx
    TerminalBackendProvider.tsx
    ThemeProvider.tsx
    ToastProvider.tsx
    WosmClientProvider.tsx
  runtime/
    paneRuntime.ts
    stationRuntime.ts
  state/
    actions.ts
    selectors.ts
    store.ts
    types.ts
    slices/
      commands.ts
      input.ts
      overlays.ts
      workspace.ts
      wosmGraph.ts
  terminal/
    backend.ts
    pty.ts
    registry.ts
  theme/
    tokens.ts
```

Rules for this layout:

- `components/ui` contains generic reusable OpenTUI primitives with no WOSM
  domain knowledge.
- `components/frame` contains app-wide layout and header regions.
- `components/panes` contains workspace pane rendering.
- `components/overlays` contains WOSM overlay, command palette, dialogs, and
  overlay hosts.
- `state`, `input`, `providers`, `terminal`, `runtime`, and `commands` contain
  non-rendering logic.

### Theme Scope

Delay broad theming. Start with tokens only:

- `theme.colors.border`
- `theme.colors.background`
- `theme.colors.muted`
- `theme.colors.focus`
- `theme.colors.warning`
- `theme.spacing.sm`
- `theme.spacing.md`
- `theme.borderRadius.panel`

Do not build a theme marketplace or deep theme system during the spike.

### ASCII Mode Mockups

Session mode:

```text
+------------------------------------------------------------------------------------------+
| [ main ] [ api ] [ db ]                         station                 [ WOSM: idle  ] |
+------------------------------------------------------------------------------------------+
|                                                                                          |
| +------------------------------------------+   +---------------------------------------+ |
| | agent                                    |   | dev server                            | |
| | /repo/.worktrees/station-design          |   | pnpm dev                              | |
| |                                          |   |                                       | |
| | codex is running here                    |   | VITE ready in 430ms                   | |
| |                                          |   | localhost:5173                        | |
| |                                          |   |                                       | |
| |                                          |   |                                       | |
| |                                          |   |                                       | |
| |                                          |   +---------------------------------------+ |
| |                                          |   +---------------------------------------+ |
| |                                          |   | db                                    | |
| |                                          |   | psql local                            | |
| |                                          |   |                                       | |
| |                                          |   | app_development=#                     | |
| |                                          |   |                                       | |
| +------------------------------------------+   +---------------------------------------+ |
|                                                                                          |
+------------------------------------------------------------------------------------------+
| agent focused | split | WOSM | palette | close pane                                      |
+------------------------------------------------------------------------------------------+
```

WOSM mode:

```text
+------------------------------------------------------------------------------------------+
| [ main ] [ api ] [ db ]                         station              [ WOSM: selected ] |
+------------------------------------------------------------------------------------------+
|                                                                                          |
| +------------------------------------------+   +---------------------------------------+ |
| | agent                                    |   | dev server                            | |
| | /repo/.worktrees/station-design          |   | pnpm dev                              | |
| |                                          |   | VITE ready in 430ms                   | |
| |                                          |   | localhost:5173                        | |
| |                                          |   |                                       | |
| |              +---------------------------------------------------+                   | |
| |              | WOSM                                              |                   | |
| |              +---------------------------------------------------+                   | |
| |              | project  wosm                                     |                   | |
| |              | branch   station-design                           |                   | |
| |              |                                                   |                   | |
| |              | [1] station-design      codex  working            |                   | |
| |              | [2] api-cleanup         codex  needs attention    |                   | |
| |              | [3] db-fixtures         none   ready              |                   | |
| |              |                                                   |                   | |
| |              | N:new  R:refresh  Enter:focus  Esc:back           |                   | |
| |              +---------------------------------------------------+                   | |
| |                                          |   +---------------------------------------+ |
| |                                          |   | db                                    | |
| |                                          |   | psql local                            | |
| |                                          |   | app_development=#                     | |
| +------------------------------------------+   +---------------------------------------+ |
|                                                                                          |
+------------------------------------------------------------------------------------------+
| WOSM overlay focused | Esc returns focus to previous pane                                 |
+------------------------------------------------------------------------------------------+
```

## Secondary Goals

### A. Determine Whether OpenTUI Is Viable

Evaluate whether OpenTUI can support Station's needs:

- full-screen rendering
- layout
- mouse input
- keyboard input
- focus
- frame updates
- performance
- integration with PTY-backed panes
- packaging/runtime constraints

The output should be a recommendation:

- continue with OpenTUI
- continue with OpenTUI but isolate runtime/package constraints
- abandon OpenTUI and test another renderer

### B. Determine Whether The PTY Stack Is Viable

Evaluate:

- PTY process lifecycle
- shell compatibility
- agent TUI compatibility
- ANSI rendering
- alternate screen behavior
- paste behavior
- Ctrl-C / Ctrl-D / signals
- resize behavior
- Unicode width issues
- scrollback feasibility

The output should be an honest technical memo:

- what works
- what is janky
- what is a blocker
- what needs deeper implementation

### C. Clarify Future Provider Architecture

If Station feels promising, define what a future Station terminal provider might
look like.

Future provider concept:

- provider id: `station`
- package: `integrations/terminal/station`
- Station reports terminal targets to observer
- observer can submit terminal intents to Station
- `terminal.focus`, `terminal.close`, launch, cleanup, diagnostics become
  normalized across tmux and Station

This is only a design outcome for the spike, not an implementation requirement.

## Explicit Non-Goals

### 1. Do Not Replace Tmux Mode

Station is not a replacement for the existing tmux/classic workflow during the
spike.

Do not remove or degrade:

- tmux popup mode
- tmux pane/window routing
- existing TUI dashboard
- current CLI flows

Station may become default later only if the spike proves it is better for new
users.

### 2. Do Not Build A Full Terminal Multiplexer Yet

The spike should not attempt to match tmux, Zellij, or Herdr feature-for-feature.

Do not build:

- persistent detach/reattach
- remote attach
- full session restore
- pane history database
- copy mode
- named workspaces
- tab system
- plugin system
- layout serialization
- synchronized panes
- advanced pane drag/drop
- remote SSH workspace management

Those are future product decisions.

### 3. Do Not Create `integrations/terminal/station` Yet

Do not introduce a Station terminal provider in the first spike.

Reason:

The spike should prove local UX first. Provider contracts should only be added
after Station proves that owning panes is worth productizing.

Allowed:

- sketch future provider design
- identify required contracts
- note observer changes needed later

Not allowed:

- changing observer contracts prematurely
- making Station a first-class terminal provider before UX proof

### 4. Do Not Rebuild Diff/Review UI

Station should not implement custom diff UI, merge UI, review UI, or PR review.

Instead:

- open `difftastic`
- open `git diff`
- open `gh pr view`
- open user-configured review commands
- run existing terminal tools inside panes

This is a philosophical guardrail.

Station can have a `diff` button. That button should run a real diff tool.

### 5. Do Not Rebuild Agent UIs

Do not parse or reinterpret Codex/OpenCode/Cursor/Pi UI as custom WOSM widgets.

For the spike, agents run as real terminal processes in real panes.

Allowed:

- launch agent commands
- focus agent panes
- label panes using WOSM metadata
- show observer-known agent/session state outside the pane

Not allowed:

- custom rendering of agent conversations
- replacing agent approval UI
- fake agent transcript viewer
- vendor-specific UI cloning

### 6. Do Not Import Herdr Code Casually

Do not copy or integrate Herdr source code during the spike.

Learning from Herdr UX is allowed.

Direct code reuse is not allowed unless there is a deliberate licensing and
business decision.

Reason:

Herdr is not merely free code to paste. Its license/commercial posture must be
treated as a product/company decision.

### 7. Do Not Make Station Block Existing Build/Test/Release

Station is experimental.

It should not become required for:

- `pnpm build`
- `pnpm test:all`
- release smoke
- existing local-use flow
- current CLI/TUI users

If Station needs a different runtime, native dependency, or experimental flag,
isolate it.

For the spike, treat OpenTUI, Bun, Node 26, native FFI, Zig, PTY-native
packages, and terminal-emulator libraries as experimental Station dependencies.
They must not become root WOSM development requirements.

Allowed:

- a Station-specific devcontainer under `experimental/station/.devcontainer`
- a Station-specific Dockerfile under `experimental/station/.devcontainer`
- named Docker volumes for Station `node_modules`, Bun cache, Node cache, Zig
  cache, and renderer build artifacts
- a container lane that proves renderer, layout, PTY basics, and reproducible
  install behavior
- an explicit host lab lane that checks for dependencies and exits with a clear
  message when missing

Not allowed:

- changing the root Node.js engine away from 24.x
- changing the root package manager away from pnpm 11
- adding Bun as a root package-manager requirement
- adding Node 26 as a root development requirement
- adding OpenTUI dependencies to the root install path before promotion
- adding Station to `pnpm build`, `pnpm test:all`, release smoke, or ordinary CI
  before promotion
- scripts that auto-install Bun, Node 26, Zig, or OpenTUI-native requirements on
  the host machine without an explicit user action

The container lane and host lab lane answer different questions:

- container lane: is the renderer/runtime stack reproducible and isolated?
- host lab lane: does Station feel correct with the user's real shell, tools,
  credentials, terminal emulator, and local WOSM state?

### 8. Do Not Solve Cloud/Team Mode

No cloud sync.

No shared team state.

No auth.

No accounts.

No hosted observer.

No billing.

No remote execution platform.

Station is a local workspace spike.

### 9. Do Not Over-Theme The Metaphor

Use the name Station, but keep UI language normal.

Use:

- panes
- projects
- sessions
- agents
- splits
- diffs
- tests
- cleanup

Avoid overusing:

- tracks
- platforms
- departures
- arrivals
- conductors
- trains

The name can carry the metaphor. The product should remain technically clear.

### 10. Do Not Optimize Visual Polish Before Proving Feel

The spike should prioritize interaction feel over styling.

Important:

- typing feels correct
- click focus works
- split/close is clear
- agent/diff panes run
- WOSM state is visible
- resize does not break everything

Less important:

- perfect colors
- themes
- animations
- beautiful borders
- marketing polish

## Success Criteria

The Station spike is successful if all of these are true:

- `wosm station` launches a full-screen workspace.
- Station can spawn and render at least one real shell process.
- Station can split panes right/below.
- Station can route keyboard input to the focused pane.
- Station can focus panes by mouse click.
- Station can resize without corrupting the workspace.
- Station can run at least one real agent command in a pane.
- Station can run a real diff command in a pane.
- Station can display useful WOSM project/session state beside panes.
- Existing tmux/classic workflows remain unaffected.
- The resulting demo feels like a plausible default UX for new users.

## Failure Criteria / Kill Signals

The spike should be stopped, paused, or redirected if:

- real terminal apps feel fundamentally broken inside panes
- keyboard input is unreliable
- mouse focus is too fragile
- resize corrupts output in common cases
- Codex/OpenCode-style TUIs cannot run acceptably
- the renderer/runtime stack creates unacceptable packaging friction
- Station feels like a worse Herdr/tmux rather than a WOSM-specific workspace
- WOSM state does not add visible user value
- the work starts expanding into a full terminal emulator rewrite before the
  product feel is proven

A failed spike is still useful if it proves that WOSM should remain tmux-first.

## Deliverables

At the end of the spike, produce:

1. `experimental/station/apps/station` prototype
2. `wosm station` command path
3. short demo recording or script
4. technical notes on renderer/PTY viability
5. product notes on UX feel
6. dependency-isolation notes covering container lane, host lab lane, and
   promotion risk
7. recommendation:

   - continue Station
   - continue Station with narrower scope
   - pause Station and return to tmux/classic UX
   - choose a different renderer/runtime stack
   - promote the spike toward top-level `apps/station`

## Recommended Timebox

Initial spike:

- 1 week minimum
- 2 weeks target
- 3 weeks hard maximum before a continue/pause decision

Do not let Station become an indefinite rewrite without a working demo.
