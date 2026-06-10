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
- top bar / command chrome
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

> WOSM owns the workspace chrome. Terminal tools still do the work.

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
