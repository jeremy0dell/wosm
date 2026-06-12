# WOSM Station Spike - Goals And Non-Goals

Status: active spike plan
Date: 2026-06-10
Updated: 2026-06-11

## Spike Purpose

Prove whether WOSM should have a full-screen workspace mode that owns panes,
mouse focus, and WOSM-aware actions while still running real terminal processes
inside those panes.

Station mode should answer one business/product question:

> Can WOSM become approachable for users who do not want to learn tmux, while
> preserving the terminal-native power that makes WOSM valuable?

This is a spike, not a rewrite commitment.

## Phased Plan And Status

Status as of 2026-06-11. This is the working sequence for the rest of the
spike. Phases land in order unless running code proves a better order. Update
the checkboxes and the Spike Log when a slice lands.

### Phase 0 - Foundations (done 2026-06-11)

- [x] isolated experiment under `experimental/station`: Bun + OpenTUI app,
      container lane, host lab lane, doctor script (Goal 1)
- [x] mock observer snapshot rendered behind a source boundary; the fixture is
      TypeScript typed `satisfies WosmSnapshot`
- [x] PTY pane POC: one real shell pane with input passthrough, Ctrl-C
      forwarding, Ctrl-Q exit, and a Node sidecar owning `node-pty`
      (Goal 3 minimum; see Spike Log)
- [x] shared rich-client runtime: `packages/client` PR 1 and PR 2
      ([client plan](client_package_observer_runtime_plan.md))
- [x] live read-only observer overlay through `@wosm/client` (client plan
      PR 3): Ctrl-O / header-click toggle, mock-versus-live decided in one
      source factory, link-script dependency mechanics, doctor dist checks
- [x] chords matched in both legacy control-byte and kitty-protocol CSI-u forms

Debt carried forward deliberately: input handling is one ad hoc handler chain
in `main.tsx`, and `wosm station` is not a CLI command yet (launch is
`bun run station` inside the experiment).

Resolved 2026-06-12: the ad hoc input-handler debt is paid by Phase 1; all
input now routes through the keymap stack, router, and coordination store
(see the Phase 1 section and Spike Log entry).

Resolved 2026-06-12: the strip-ANSI renderer debt is paid. Panes now render
through a real VT screen model (`@xterm/headless` behind
`src/terminal/vt/screen.ts`) and a direct-buffer `TerminalScreenRenderable`;
see the Spike Log entry and
[station_vt_engine_decision.md](station_vt_engine_decision.md).

### Phase 1 - Input Router And Coordination Store (done 2026-06-12)

Input routing is the central design problem (see Input Routing below). Replace
the ad hoc `prependInputHandlers` chain and the module-local overlay store in
`main.tsx` with the router and store shape from Current Design Direction:

- [x] coordination store with initial `workspace` and `input` slices; overlay
      visibility moves out of the module-local store in `main.tsx`
      (`src/state/{types,store,selectors}.ts`)
- [x] `FocusTarget` union: header, pane, overlay, dialog
- [x] keymap stack with the documented priority order (`src/input/keymaps.ts`;
      all seven priority slots named, three layers registered)
- [x] router returns explicit outcomes: handled app command, terminal write,
      focus change, overlay open/close, ignored (`src/input/router.ts`; the
      doc's single "ignored" split into `swallowed`/`ignored`, see the
      amendments below)
- [x] existing behavior re-lands through the router unchanged: Ctrl-Q exit,
      Ctrl-O / header-click toggle, overlay input swallow, terminal passthrough
- [x] reserved WOSM chords stay available while a terminal pane is focused
      (and while the overlay swallow is active; reserved keys pierce every
      catch-all)

Exit bar: all current input behavior routes through the router and store, and
adding a chord or focus target is a registration, not a new conditional.
Completing this phase unblocks client plan PR 4, which is gated on the Station
input router.

### Phase 2 - Multi-Pane Layout (Goal 4)

- [ ] pane records in workspace state: `panes`, `activePaneId`, split
      metadata; no `PaneTree` abstraction yet
- [ ] `PtyRegistry` generalized from the single-pane POC to pane-id -> process
- [ ] split right and split below
- [ ] focus next pane and click-pane-to-focus
- [ ] close pane cleanly
- [ ] terminal window resize reflows panes without corrupting the workspace
- [x] decide the renderer-debt step: decided and implemented 2026-06-12.
      `TerminalBufferStore` is realized as the per-pane VT screen store
      (`src/terminal/vt/screen.ts`, engine `@xterm/headless`) plus the
      `TerminalScreenRenderable` direct-buffer renderer. Multi-pane work
      generalizes by creating one store per pane id (Secondary Goal B memo:
      [station_vt_engine_decision.md](station_vt_engine_decision.md))

Exit bar: split/focus/close feels boring and reliable.

### Phase 3 - WOSM-Aware Actions And Command Dispatch (Goals 6-7)

- [ ] open a shell pane in the current project root or selected worktree from
      WOSM overlay context
- [ ] `diff` action opens a real diff tool in a pane: `difftastic`, fallback
      `git diff` (Goal 7)
- [ ] agent action launches a real agent command in a pane, following Session
      And Primary Agent Semantics for what is and is not the primary agent
- [x] Station command dispatch through `@wosm/client` (client plan PR 4),
      starting with reconcile/refresh plus one focus or create command
      (done 2026-06-12; see the Spike Log entry and the client plan's PR 4
      section — landed ahead of the rest of Phase 3 because it was gated
      only on Phase 1's router)

Exit bar: the difftastic-style workflow steps 1-5 work end to end.

### Phase 4 - Demo And Spike Verdict (Goal 10)

- [ ] `wosm station` command path, or an explicit decision to keep the
      experiment-local launcher until promotion
- [ ] 60-second demo recording or script
- [ ] renderer and PTY viability memos (Secondary Goals A and B)
- [ ] dependency-isolation notes: container lane, host lab lane, promotion risk
- [ ] recommendation: continue, narrow, pause, re-stack, or promote

Exit bar: a continue-or-pause decision inside the timebox. The spike started
2026-06-10: target decision by 2026-06-24, hard maximum 2026-07-01.

## Spike Log

### 2026-06-12 - Station Command Dispatch Through The Shared Client (PR 4)

Client plan PR 4 landed. Station's WOSM view dispatches real commands —
row-activate focus, jump-to-session on click, Z refresh, and the
new-session/add-project/remove/rename flows — through the same single
`@wosm/client` `ObserverService` that feeds runtime state.

The substance (the service swap itself had already landed with the client
boundary unification):

- The live client's service facet is now dashboard-core's
  `bridgeOperationService(rawService, runtime)`: reconcile and operation
  snapshot loads route through the client runtime, while dispatch and
  command-completion waits pass through to the one shared connection. This
  resolves PR #78 review finding #3 — a snapshot applied around the runtime
  was silently reverted by the next incremental event, and the connected
  transition plus "Observer reconnected." recovery toast now arrive via the
  state subscription.
- A behavioral suite (`src/wosm/store/wosmCommandDispatch.test.ts`) pins the
  paths: focus dispatch with completion wait, click/key equivalence, Z
  reconcile through the runtime, a convergence regression that fails on the
  pre-fix wiring, reconcile failure feedback, and the reconcile-driven
  connected transition with the recovery toast.
- Mock mode keeps the rejecting service by design; its rejection copy names
  mock mode instead of the PR 4 gate. The view store now labels safe errors
  as Station rather than the TUI default.
- Known gap carried forward: Station's runtime runs without the observer
  bridge hooks, so `command.failed` event notices do not surface as toasts;
  failures still surface through command-completion waits.

### 2026-06-12 - WOSM View At apps/tui Popup Parity, With Mouse

The read-only WOSM overlay is now the full dashboard: project groups,
worktree rows (slots, status markers, priority truncation, right-aligned
diff/PR/check metadata), search/collapse/remove/rename flows, the help
overlay, the new-session and add-project bottom sheets, toasts, and the
loading/waiting/display-only connection states — at parity with the
`apps/tui` popup, plus mouse (wheel scroll, row click, header-click
collapse, scroll-indicator paging, sheet picker clicks, toast dismiss,
hover affordances).

The shape (`apps/station/src/wosm/`, details in `ported/PROVENANCE.md` and
`README.md`):

- apps/tui's render-framework-free logic layer is ported verbatim
  (transition machine, screen handlers, selectors, viewport math, the row
  constraint solver, flows, toasts, local rows) with its test suites; the
  OpenTUI view layer is the only rewrite, so parity holds by construction
  and golden-frame matrices pin it per scenario fixture and surface size.
- The keymap is data over the machine: per-mode binding tables drive help
  and mouse vocabulary, with coverage tests that fail on omission drift.
  The overlay keymap slot's read-only swallow placeholder is replaced by
  the dashboard layer; reserved chords still pierce; dismiss intents map
  to overlay-close so the coordination store keeps owning visibility.
- Mouse rides the router: `MouseTargetRef` gained a `wosm` arm and the
  bindings table delegates to one pure `routeWosmMouse(target, eventKind,
  store)` with a (mode x target) guard matrix; clicks mean exactly what
  the equivalent key means.
- Mutating command dispatch is stubbed behind an ObserverService whose
  rejections name the client-plan PR 4 gate, while the real pending-row
  visuals and toast paths run; the mock source gained the multi-scenario
  fixture set (`WOSM_STATION_SCENARIO`: many-projects,
  attention-and-failures, disconnected), closing that open item.

Goal 5 (WOSM state beside panes) now reads as session management rather
than a status list; jump-to-session and real dispatch land with PR 4.

### 2026-06-12 - Input Router And Coordination Store (Phase 1)

Phase 1 landed. All Station input - key sequences, mouse, paste - now routes
through one pure router over a coordination store; the ad hoc handler chain
(`appInput.ts`) and the module-local overlay store in `main.tsx` are gone.

The shape:

```text
src/state/      types (PaneId/OverlayId/DialogId, FocusTarget), vanilla store
                (subscribe/getState + explicit actions), scalar selectors
src/input/      keymaps.ts (generic layer stack + reserved-key resolution),
                router.ts (closed RouteOutcome union, routeKey/routeMouse/
                routePaste), stationBindings.ts (the registration site),
                stationInput.ts (normalize -> route -> execute composition)
```

What this slice proved (all behavior-identical against the pre-existing e2e
suite, plus new unit suites for store, keymaps, and router):

- Reserved chords are registrations, not conditionals: Ctrl-Q/Ctrl-O are
  `reserved: true` bindings in the workspace layer; the stack-level resolve
  lets reserved keys fall through every catch-all (overlay swallow, terminal
  passthrough) to the layer that binds them - Herdr-style interception,
  derived from registrations.
- Terminal delivery propagates: a `terminal-write` outcome returns the
  registry's boolean, so a dead pane returns false and OpenTUI's own
  capability/focus handlers still see the sequence.
- Focus restore is store policy: `openOverlay` records pane focus,
  `closeOverlay` restores it or falls back to the active pane; header clicks
  never take focus.
- Paste stays a separate dispatch routed by focus, with `preventDefault`
  only on actual delivery.
- Byte normalization (reply stripping, kitty CSI-u translation, key-release
  consumption) runs before routing; the router never sees raw kitty
  sequences or empty keys.

Exit bar verified: a new chord is one `KeyBinding` in `stationBindings.ts`; a
new mouse target is one entry in the mouse-bindings table; a new modal layer
is a registration into a named priority slot. Client plan PR 4 is unblocked.

### 2026-06-12 - Real VT Screen Model And Styled Pane Rendering

The pane renderer debt is paid. The pipeline is now:

```text
node-pty bridge -> StationTerminalProcess -> vt/screen.ts (@xterm/headless)
  -> vt/rows.ts (style-merged spans) -> TerminalScreenRenderable (direct
  OptimizedBuffer draw) -> OpenTUI frame
```

What this slice proved (all backed by named tests; `bun run test`,
`bun run test:pty`, `bun run test:stress`):

- Colors (16/256/truecolor), attributes, cursor, erase ops, alt-screen
  enter/exit with primary restore, DECSTBM regions, wrapping, wide chars,
  scrollback capping, and DEC line-drawing all render correctly
  (37-case conformance catalog in `src/terminal/vt/cases/`).
- Frame-level tests assert the actual composited OpenTUI frame via the
  test renderer: styled cells, inverse cursor, resize reflow with no stale
  cells, alt-screen takeover/restore.
- Terminal query replies (DA1/DSR/CPR from xterm; OSC 10/11 answered by the
  store because headless xterm does not) round-trip back to the PTY, so
  crossterm/termenv-based TUIs do not hang at startup.
- A real `vi -c q` enters and exits the alt screen through the production
  pipeline (extra-gated smoke test).
- PTY size now derives from the laid-out pane interior (fixes the
  header-row off-by-one), and the overlay's height-0 collapse no longer
  reaches the PTY.

Pulled-forward Phase 1 input fixes that correctness forced now: kitty CSI-u
sequences are translated to legacy bytes before reaching pane children
(`vt/kittyToLegacy.ts`), paste is forwarded explicitly (OpenTUI routes paste
around the sequence handlers) with bracketed-paste wrapping decided by the
child's DECSET 2004 state, and Ctrl-Q now unmounts before destroying the
renderer so the bridge and shell actually die.

Engine decision, alternatives, risks, and the Effect boundary posture are in
[station_vt_engine_decision.md](station_vt_engine_decision.md) (this is the
Secondary Goal B viability memo).

### 2026-06-11 - PTY POC In Station

The Station experiment now has the first PTY-backed pane proof of concept under
`experimental/station/apps/station/src/terminal/`.

What this slice proved:

- `node-pty` can be kept behind a Station-local terminal boundary.
- Station can spawn a real PTY-backed shell process.
- OpenTUI input can be routed into the active PTY.
- PTY output can be rendered back into the Station pane.
- Station can reserve `Ctrl-Q` for app exit while forwarding `Ctrl-C` to the
  child process.
- The local smoke probe can verify child-process output with `bun run test:pty`.

Implementation note: Bun owns the OpenTUI app, while a small Node sidecar owns
`node-pty`. The sidecar is intentionally experiment-local because Bun extracted
`node-pty`'s `spawn-helper` without the executable bit, and direct Bun +
`node-pty` interactive shell behavior was not reliable enough for the POC.

Known limitation: rendering is intentionally incomplete. The current pane strips
ANSI and writes recent text into an OpenTUI text node. Cursor movement, prompt
redraws, wrapping, colors, alternate-screen programs, and full terminal
semantics should be treated as expected renderer debt until Station has a real
VT parser / terminal screen model.

Manual verification for this commit:

```bash
cd experimental/station
bun run station
```

Then run `pwd` inside the Station pane, verify output renders in the pane, use
`Ctrl-C` against a running command, and use `Ctrl-Q` to exit Station cleanly.

### 2026-06-11 - Live Observer Overlay Through @wosm/client

Station renders live observer state in the WOSM overlay through the shared
client runtime. The implementation record, dependency mechanics
(`scripts/link-wosm-packages.sh`, the doctor's dist checks, the container lane
mounting the repo root), and validation live in the
[client plan PR 3 section](client_package_observer_runtime_plan.md).

Slice notes:

- WOSM mode is a `Ctrl-O` toggle implemented as an overlay: the PTY pane stays
  mounted so the shell survives WOSM mode, and input is swallowed while the
  overlay is active.
- The snapshot source is subscribable (`start/stop/getState/subscribe` plus a
  connection state); the overlay consumes mock and live sources the same way
  via `useSyncExternalStore`.
- With no observer reachable the overlay shows a calm `reconnecting since ...`
  status; `displayOnly` keeps the last good snapshot.

### 2026-06-11 - Source Factory, Header Click Target, Kitty Chords

Follow-up hardening after the overlay landed:

- Mock-versus-live selection collapsed into one factory
  (`createStationWosmStateSource`, selected by `WOSM_STATION_SOURCE`); sources
  stay identity-free downstream of the factory.
- The whole header row is a mouse click target for toggling WOSM mode, because
  some terminal setups never deliver `Ctrl-O` to the app.
- Station chords are matched in both legacy control-byte form and kitty
  keyboard protocol CSI-u form (with the kitty protocol active, `Ctrl-O`
  arrives as `ESC[111;5u`, which a bare control-byte comparison misses).

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

- `StationWorkspace` or `StationSession` for product state
- `TerminalPane` records for pane metadata and intent
- `PtyRegistry` for live PTY handles and process lifecycle
- `TerminalBufferStore` for renderable terminal screen state
- `StationController` as thin event-to-action glue
- layout helpers, extracted only when split/focus logic needs them

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

## WOSM State Sources

Station needs WOSM state before it has a live observer connector. Treat the WOSM
state provider as a source-swappable boundary from the start.

### Dev Mock State

Station should have mock WOSM data available out of the box for design and
layout work.

Use a dev env flag to choose mock data:

```bash
WOSM_STATION_SOURCE=mock experimental/station/scripts/run-host.sh --hot
```

This is implemented: `createStationWosmClient` is the single factory that
reads `WOSM_STATION_SOURCE` (`observer` is the default, `mock` opts in). The
behavior:

- mock mode does not require a running observer
- mock mode does not connect to the observer socket
- mock mode loads large realistic JSON fixtures from the Station experiment
- mock mode can show multiple projects, worktrees, sessions, agent states,
  dirty branches, command lifecycle examples, and disconnected/error examples
- mock mode should be deterministic so visual layout and input tests can use it

Status as of 2026-06-12: the multi-scenario fixture set landed with the
WOSM-view dashboard work. Typed TypeScript fixtures supersede the original
raw-JSON suggestion here: the `satisfies` check already caught a real
contract drift in the baseline fixture's `checks` shape.

```text
experimental/station/apps/station/src/sources/fixtures/
  mockObserverSnapshot.ts   baseline snapshot (WOSM_STATION_SCENARIO=baseline)
experimental/station/apps/station/src/wosm/fixtures/
  scenarios.ts              many-projects, attention-and-failures,
                            disconnected (displayOnly + last good snapshot);
                            selected via WOSM_STATION_SCENARIO in the source
                            factory, used by the golden-frame matrices
```

Mock data should satisfy the same contract-shaped structures that live Station
will consume. Do not invent a separate Station-only graph shape unless the UI
needs a derived projection. Derived projections should be selectors, not fixture
schema.

### Live Observer State

Status as of 2026-06-12: shipped for read-only state and commands.
`packages/client` PRs 1-4 are implemented: the overlay consumes the live
runtime through the source factory, and command dispatch flows through the
same shared client boundary.

Observer-connected Station work depends on
[`packages/client`](client_package_observer_runtime_plan.md).

Station can continue to prototype local layout, input routing, and fake panes
inside `experimental/station` before that package exists, and mock WOSM state is
the preferred early path for overlay and dashboard layout. However, Station
should not grow a Station-specific live observer connector for the WOSM overlay.
Live observer snapshots, event subscriptions, reconnect behavior, command
dispatch, and command completion should come from the shared rich-client runtime
planned in `packages/client`.

The goal is for Station to share the same observer-consumption boundary as
`apps/tui` while keeping Station-specific concerns local:

- Station owns frame/header/panes/overlays/input/PTY runtime.
- `packages/client` owns rich-client synchronization with observer truth.
- `packages/protocol` owns low-level socket transport and message validation.
- `packages/contracts` owns shared schemas and types.

The Station provider boundary should hide whether WOSM state came from mock
fixtures or the live `packages/client` runtime.

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

This store is app-level coordination state. It is not the WOSM or Station
session. A session is the place where the user does work in a worktree. The
coordination store can hold selected ids and route actions, but it should not
subsume session ownership or become the product model.

The coordination store should own normalized state that multiple parts of
Station must agree on:

- active mode and active overlay
- header tabs/windows
- pane layout and pane metadata
- active focus target
- command lifecycle metadata
- observer snapshot-derived WOSM graph summaries
- selected project/worktree/session ids and focus metadata

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
- `WosmStateProvider`
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

Phase 1 design decisions (2026-06-12):

- Store mechanics: hand-rolled vanilla store (`subscribe`/`getState` +
  `useSyncExternalStore`, the shape the app already uses three times), not
  React context and not Zustand. The router runs outside React
  (`prependInputHandlers`, renderable callbacks), so the store must be
  vanilla-JS-first; Zustand-vanilla is the drop-in upgrade later if selector
  pain appears.
- Focus is a store value mutated by a small set of explicit actions
  (`focusPane`, overlay toggle, dialog push/pop, close-pane successor), never
  emergent from per-component focus handlers. OpenTUI's own
  `focusable`/`focus()` system stays deliberately unused for panes — two
  focus systems fighting is the classic TUI bug.
- Mouse: pane `onMouseDown` handlers are the entry point (hit-testing is the
  framework's job) but delegate to a shared `routeMouse(paneId, event,
  state)` returning the same outcome vocabulary as the key router. Phase 1
  scope is `focusPane` guarded by modal state; mouse forwarding to
  mouse-mode children (vim/htop) comes later and needs
  `mouseTrackingMode` exposed on the screen view.
- Pane close is one reducer: successor focus computed before mutation, state
  updated first, PTY/screen disposed imperatively after (never trust unmount
  timing for processes). Last pane closed falls back to the Zero-Pane State.
- Byte normalization (terminal-reply stripping, kitty CSI-u translation)
  runs before routing and is not the router's concern.
- Validation: Herdr routes every keystroke through one central dispatcher
  (`App::handle_key`) with modal modes > copy mode > navigate mode >
  terminal passthrough, prefix-key interception inside terminal mode, and a
  separate paste dispatch — the same architecture as this section. Worth
  stealing when scrollback lands: Herdr intercepts plain PageUp/PageDown for
  scrollback only when the pane is not in alt-screen or mouse-reporting
  mode.

Amendments from the Phase 1 implementation (2026-06-12):

- The single "ignored" outcome is two outcomes in code: `swallowed`
  (consumed with no effect — modal layers eating input) and `ignored` (not
  consumed; OpenTUI's own handlers may still act). The overlay swallow and
  the dead-pane fall-through need opposite consume semantics.
- Reserved chords are stronger than "available while a terminal pane is
  focused": a `reserved: true` binding pierces every catch-all, including
  the overlay swallow, which is how Ctrl-Q/Ctrl-O keep working in WOSM
  mode. An explicit binding in a higher layer can still override a reserved
  chord (a future dialog may bind Esc).
- `routeMouse(paneId, event, state)` became
  `routeMouse(target, event, state)` with a target-ref union
  (`header | pane`), because header clicks cannot be expressed as a pane
  id. Mouse handlers are a table keyed by target kind, registered next to
  the key bindings. Header clicks never take focus; they only toggle the
  overlay, and they keep working while the overlay is open (the mouse path
  is the documented fallback when Ctrl-O never arrives).
- The proposed `input/focus.ts` does not exist: focus transitions live
  entirely in store actions per the focus decision above, so a separate
  focus module had nothing left to own.
- Binding keys are legacy byte forms for now. Legacy bytes cannot express
  Ctrl+Shift distinctions or modified F-keys and conflate Tab/Ctrl-I,
  Enter/Ctrl-M, Esc/Ctrl-[ — never reserve those collision bytes. When a
  future layer (command palette) needs richer chords, the binding key
  becomes a normalized key descriptor; the registration shape stays.

### Working Domains

Keep these domains separate from the beginning:

- `workspace`: app-level tabs/windows, active workspace, focusable surfaces
- `workSession`: per-worktree user work area, pane records, primary agent pane
  id, and selected WOSM session ids
- `wosmGraph`: observer snapshot summaries, selected WOSM project/worktree/session
- `terminal`: terminal ids, backend attachment, resize, write, kill, process role
- `agent`: harness identity, status, hook-derived state, launch commands
- `worktree`: project path, branch, dirty state, Worktrunk identity
- `commands`: command registry, palette entries, keybinding targets
- `input`: key routing, mouse routing, focus, overlay/modal stack

### Session And Primary Agent Semantics

Station should start from WOSM's product model, not from pane mechanics. In this
plan, a session means the place where the user does work in a worktree. It is a
per-worktree work area with panes, focus, and a possible primary agent. It is not
global app state.

A pane is the atomic terminal viewport and PTY host, but a Station work session
is the product container for one project/worktree context and the panes attached
to it.

Do not let `StationRuntime` become a god object. If a runtime/controller exists,
it should only coordinate lifecycle and route UI events to narrower services.
It should not own terminal emulation, process handles, pane layout, WOSM graph
state, and agent semantics directly.

Use this split as the initial mental model:

```text
StationWorkSession
  product state for one project/worktree work area:
  selected project/worktree/session ids, pane records, active pane,
  primary agent pane id, and WOSM-aware actions

TerminalPane
  pane metadata:
  pane id, title, cwd, command intent, role, status, and linked WOSM ids

PtyRegistry
  runtime resources:
  pane id -> live PTY process, write/resize/signal/cleanup

TerminalBufferStore
  render state:
  pane id -> parsed terminal screen, cursor, styles, scrollback, alt screen

StationController
  thin glue:
  keyboard/mouse event -> workspace action -> registry/buffer/layout update
```

Avoid making `PaneTree` the top-level product abstraction. Pane layout can start
as simple workspace state such as `panes`, `activePaneId`, and split metadata.
Extract a dedicated `PaneTree` only when split-right, split-below, close,
focus-next, and layout recomputation become complex enough to need one.

The work session owns the meaning of a pane. The PTY registry owns only the
live process handle. For example:

```text
StationWorkSession says:
  pane abc is the primary Codex agent for worktree wt_feature

PtyRegistry knows:
  pane abc is process pid 12345, write bytes here, resize here, kill here

TerminalBufferStore knows:
  pane abc currently renders these rows, cursor position, and styles
```

#### The Primary Agent

Station needs an explicit concept of the WOSM-managed primary agent for a
workspace. This is the pane/process that backs the WOSM session row, receives
normal focus actions, contributes agent status, and is affected by WOSM agent
cleanup/resume behavior.

The primary agent should be explicit. It is created by WOSM-aware actions such
as `session.create`, `session.startAgent`, or a future Station action that
launches an agent for the selected worktree. It should not be inferred just
because a terminal process happens to look like `codex`, `opencode`, `cursor`,
or `pi`.

A Station workspace may also contain ad hoc agent panes. These are user-started
agent processes in ordinary panes. WOSM may observe or label them when safe, but
they should not automatically become the primary agent.

This distinction answers important behavior questions:

- row status, notifications, and primary focus target come from the primary
  agent, not an arbitrary matching process
- `session.sendPrompt`, future resume, and agent cleanup target the primary
  agent unless the user explicitly chooses another target
- process discovery can suggest adoption candidates, but should not silently
  promote them

#### Closing Agent Panes

Closing the primary agent pane is a guarded action, not the same as closing a
throwaway shell pane.

Initial policy:

- closing an idle shell pane can be immediate
- closing a pane with a non-agent command should warn only when the process is
  still running or the pane has unsaved terminal state worth preserving
- closing the primary agent pane while the agent is active should require an
  explicit confirmation or force action
- closing the primary agent pane should update WOSM session/workspace state,
  not only kill a PTY
- if recovery metadata exists, the workspace can become recoverable/resumable
- if no recovery metadata exists, the workspace should show exited/no-agent
  state clearly instead of pretending the session is still live

If the user starts an agent manually in another pane, closing that pane should
follow ordinary running-process rules unless the user explicitly adopts it as
the primary agent.

#### Zero-Pane State

Closing the last pane must not exit Station and must not show a generic empty
screen. The zero-pane state is a session lifecycle moment with two prompted
actions (decided 2026-06-12):

- open the primary agent pane for this workspace (the explicit
  `session.startAgent`-style creation path; doubles as the recovery path when
  the agent exited and the workspace is resumable)
- clean up this session, here or from the WOSM view (the guarded teardown
  path; the WOSM view stays the authoritative venue so the empty state never
  grows into a second session-management UI)

Focus falls back to the WOSM view content when the last pane closes. Ctrl-Q
remains the prominent quit affordance for tmux muscle memory ("last pane
closed" sometimes means "I'm done").

#### Adoption And Promotion

Station can eventually support adopting an ad hoc agent pane as the primary
agent, but adoption must be explicit and backed by enough identity evidence to
avoid corrupting session state.

Minimum adoption questions:

- Which WOSM project and worktree does this pane belong to?
- Which harness provider is it?
- Is there a provider-native session id or other stable recovery handle?
- Is there already a live primary agent for this workspace?
- What happens to the old primary agent if this pane is promoted?

Until those are answered in running code, Station should keep manual agent
panes separate from the WOSM-managed primary agent.

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
  mocks/
    wosm/
      active-workspace.json
      attention-and-failures.json
      disconnected.json
      many-projects.json
  providers/
    ClipboardProvider.tsx
    CommandProvider.tsx
    DialogProvider.tsx
    KeymapProvider.tsx
    TerminalBackendProvider.tsx
    ThemeProvider.tsx
    ToastProvider.tsx
    WosmStateProvider.tsx
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

- [ ] `wosm station` launches a full-screen workspace. The full-screen
      workspace exists; the `wosm station` command path is Phase 4. Launch is
      `bun run station` inside `experimental/station`.
- [x] Station can spawn and render at least one real shell process. Renderer
      debt resolved 2026-06-12: full VT screen model (`@xterm/headless`),
      styled rendering, alt-screen, and query replies, with a conformance
      test catalog as evidence.
- [ ] Station can split panes right/below. Phase 2.
- [ ] Station can route keyboard input to the focused pane. Proven for the
      single POC pane; counts once multi-pane focus exists. Phases 1-2.
- [ ] Station can focus panes by mouse click. The header is a click target
      today; pane click focus is Phase 2.
- [ ] Station can resize without corrupting the workspace. Phase 2.
- [ ] Station can run at least one real agent command in a pane. Phase 3.
- [ ] Station can run a real diff command in a pane. Phase 3.
- [x] Station can display useful WOSM project/session state beside panes.
      Live observer overlay through `@wosm/client`.
- [x] Existing tmux/classic workflows remain unaffected. Holds so far: nothing
      outside `experimental/station` changed. This is an invariant to
      re-verify every phase, not a finished item.
- [ ] The resulting demo feels like a plausible default UX for new users.
      Phase 4.

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

The spike started 2026-06-10: target decision by 2026-06-24, hard maximum
2026-07-01.

Do not let Station become an indefinite rewrite without a working demo.
