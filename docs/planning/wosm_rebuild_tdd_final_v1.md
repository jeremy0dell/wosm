# wosm Rebuild Technical Design Document - Final V1

**Document status:** Final V1  
**Date:** 2026-05-20  
**Product:** wosm, greenfield rebuild  
**Audience:** Implementer, future contributors, agent collaborators  
**Important premise:** wosm1 is gone. There is no old source tree to recover, no migration path to preserve, and no shell backend to port. This is a rebuild from zero that keeps the product insight, not the implementation.

---

## 0. What changed in V1

V1 consolidates Drafts 1 through 8 and resolves the final operational questions. It is intended to be a coherent technical design baseline for implementation rather than another exploratory draft.

New or finalized decisions:

- Effect is standardized as selective runtime infrastructure through a small `@wosm/runtime` subset. It is used where orchestration, concurrency, cancellation, retries, typed errors, or observability matter.
- The TUI is not sheltered from Effect. It may use Effect in its high-traffic input/output and orchestration layers, such as observer connection lifecycle, event subscription, command dispatch, retries, cancellation, and cleanup. React/Ink components and pure selectors remain plain and readable.
- The protocol package may expose both an Effect-native internal client and a Promise/AsyncIterable facade. TUI service hooks may choose the Effect path when orchestration benefits from it; components should still render ordinary UI state.
- `wosm debug bundle` must exist before the first real provider integration ships. It must work with fake providers, injected failures, redaction, recent commands, events, errors, logs, provider health, snapshot state, and trace/span context.
- OpenTelemetry compatibility is designed into V1 through trace/span IDs and stable operation names, but exporter support is disabled or no-op by default until local observability is stable.
- Log and diagnostic retention are bounded by default: local-first, configurable, visible through `wosm doctor`, and never treated as source of truth.
- The companion phased development plan is updated to V1 and reflects the final testing, diagnostic, Effect, and retention decisions.
- All previously listed open questions are now resolved for the V1 baseline.
- A final consistency pass resolved stale TUI protocol wording, import-direction conflicts, outdated open-question framing, and observability/debug-bundle sequencing conflicts.

## 1. Summary

wosm is a local, terminal-native control plane for AI-agent worktree sessions.

It lets a developer manage multiple projects, multiple worktrees per project, and multiple coding agents running inside supported terminal providers while keeping the UI focused on what matters: which branches exist, which agents are working, which are idle, which need attention, and which worktrees have no agent running at all.

The canonical mental model:

```text
config.toml says what projects exist
Worktree providers say what worktrees exist
Terminal providers say what terminal targets exist
Harness providers say what agent runs are doing
observer correlates those into one live graph
TUI renders that graph and sends typed commands
CLI starts, controls, debugs, and receives hooks
```

Core architecture:

```text
                         config.toml
                    projects, defaults, policy
                              |
                              v
+----------------------------------------------------------------+
|                            observer                             |
| lazy local daemon: reconcile, correlate, route commands, log     |
|                                                                |
| project graph = config + providers + SQLite + event history      |
+-----------+--------------------+-------------------+------------+
            |                    |                   |
            v                    v                   v
 integrations/worktree/   integrations/terminal/   integrations/harness/
   worktrunk first            tmux first           codex, opencode first
            \                    |                  /
             \                   |                 /
              +------------------+----------------+
                                 |
                                 v
                       apps/tui - Ink client
                  project/worktree/session dashboard

                       apps/cli - user command
               startup, popup, doctor, debug, hook receiver
```

Design goals:

- Treat this as a greenfield rebuild, not a migration from wosm1.
- Make project config the primary source of truth for what wosm cares about.
- Show all configured projects and all known worktrees, including worktrees with no agent.
- Manage one primary agent pane per worktree in v1. Supporting panes may exist, but the primary product unit is one worktree with at most one main agent run.
- Let Worktrunk own worktree lifecycle and git-worktree semantics through a `WorktreeProvider` adapter.
- Let terminal providers own terminal topology and terminal identity binding. tmux is the reference implementation, not a core primitive.
- Let harness providers own agent-specific launch, discovery, event ingestion, and status classification. Codex and OpenCode are first implementations, not core primitives.
- Make the observer a lazy local daemon that correlates runtime truth and routes commands.
- Make the Ink TUI a client of observer snapshots/events, not a backend.
- Keep all durable runtime logic in TypeScript.
- Define contracts first and keep integrations replaceable.
- Make runtime errors observable, typed, and easy for humans or AI agents to diagnose.
- Preserve local-first, hackable, terminal-native behavior.

Non-goals:

- Recreating wosm1's shell backend.
- Recreating large `worktree.zsh`, `.ws-*` state files, or shell-sourced metadata files.
- Recreating bridge-heavy orchestration with shell bridge scripts.
- Hiding orchestration inside zsh functions.
- Making core wosm tmux-shaped, Worktrunk-shaped, or Codex-shaped just because those providers are first.
- Supporting multiple concurrent primary agents in the same worktree in v1.
- Optimizing first for Ghostty/native terminal APIs.
- Forcing Codex, OpenCode, or any future harness into Claude-shaped semantics.
- Building a remote/cloud service.
- Making Effect a whole-codebase style mandate.
- Requiring remote telemetry or OpenTelemetry export for normal local operation.

## 2. Conceptual ownership model

A useful rule set:

```text
Config defines projects.
Worktree providers adapt worktree systems into wosm contracts.
Terminal providers adapt terminal systems into wosm contracts.
Harness providers adapt agent runtimes into wosm contracts.
Observer owns correlation, command routing, eventing, and local runtime memory.
TUI owns UX only.
CLI owns startup, popup entrypoints, hook receiving, and debugging/control commands.
Contracts own everyone.
```

The short rule:

```text
Worktrunk, tmux, Codex, and OpenCode are supported integrations, not core concepts.
```

MVP operating shape:

```text
Project
  -> Worktree
       -> one primary terminal workspace
            -> one primary agent pane
            -> optional supporting panes, provider-local
```

The core contract should leave room for future terminal providers and future secondary panes, but the first product does not try to manage multiple agent runs inside one worktree. This keeps status, focus, dispatch, debug bundles, and user intent clean.


Core concepts:

```text
Project
Worktree
TerminalTarget
HarnessRun
Session
Observation
Command
Event
```

Provider examples:

```text
WorktrunkProvider adapts wt into WorktreeProvider.
TmuxProvider adapts tmux into TerminalProvider.
CodexProvider adapts Codex into HarnessProvider.
OpenCodeProvider adapts OpenCode into HarnessProvider.
```

### 2.1 Source-of-truth hierarchy

wosm should not pretend that one component owns everything. Each layer is authoritative for a different kind of truth.

```text
Config truth:
  these are the projects wosm cares about
  these are the project roots/defaults/harnesses/layouts

Worktree-provider truth:
  these are the actual worktrees under those projects

Terminal-provider truth:
  these are the actual terminal targets the provider can observe

Harness-provider truth:
  these are the actual agent runs/status signals the harness can expose

Observer SQLite truth:
  this is the command/event/session history and last known correlation map

Observer graph truth:
  this is the current normalized graph exposed to clients
```

The observer is the only place where these truths are combined.

### 2.2 What the observer owns

The observer owns the current correlated graph of wosm state. It answers questions such as:

- Which configured projects exist?
- Which worktree-provider worktrees are present for those projects?
- Which worktrees have no agent?
- Which worktrees have an idle agent?
- Which worktrees have a working agent?
- Which terminal targets correspond to which worktrees?
- Which harness runs are associated with those terminal targets?
- Which sessions need attention, are stuck, exited, or unknown?
- Which commands are in flight?
- Which providers are healthy?

The observer does **not** own raw git/worktree behavior, terminal multiplexing behavior, or agent internals.

### 2.3 What the TUI owns

The TUI owns presentation and user interaction:

- Project grouping.
- Worktree row selection.
- Search query.
- Prompt flow.
- Collapsed project groups.
- Help overlay.
- Toasts.
- Local animation state.

The TUI must not run `wt`, `tmux`, `codex`, `opencode`, or any other provider directly for core features. It receives snapshots/events and dispatches typed commands.

### 2.4 What the CLI owns

The CLI is not only for debugging, but it should stay thin. It owns:

- Starting or connecting to the lazy observer.
- Opening the TUI.
- Opening the terminal popup through the configured terminal provider.
- Running `doctor`.
- Reporting observer status/logs.
- Installing/uninstalling hooks through observer-managed commands.
- Receiving hook events, auto-starting observer when needed, and forwarding/spooling them.
- Printing snapshots/events for debugging.

The CLI does not contain core orchestration logic. It talks to the observer or starts it.

## 3. Technology decisions

### 3.1 Runtime: Node.js 24 LTS

wosm runs on Node.js LTS, specifically Node.js 24 LTS for the initial rebuild.

Recommended runtime stack:

```text
Runtime:          Node.js 24 LTS
Package manager: pnpm 11.x
Monorepo runner: Turborepo
Dev execution:   tsx where useful
Build output:    ESM JavaScript in dist/
CLI binary:      Node shebang, compiled or bundled JS
Bun:             experiment only
Deno:            not selected for v1
```

Rationale:

- wosm is local developer infrastructure, not a normal web app.
- It will depend heavily on child processes, signals, filesystem behavior, Unix sockets, tmux commands, process IDs, long-running daemon behavior, and Ink terminal rendering.
- Node has the most mature support for the npm/Ink/pnpm/Turbo ecosystem.
- Runtime predictability matters more than raw startup speed.

Bun is not rejected permanently. It is simply not the production runtime for v1. Bun can be evaluated in benchmark branches or local experiments after the Node implementation has full tests.

Runtime policy:

```text
All durable runtime code runs on Node.js LTS.
Bun may be used only for experiments until the observer, TUI, terminal provider,
Worktrunk provider, Codex harness, hook receiver, and integration tests all pass
under Bun without special cases.
```

Example root package constraints:

```json
{
  "engines": {
    "node": ">=24 <27",
    "pnpm": ">=11 <12"
  }
}
```

If broader machine compatibility becomes important, this can soften to `node >=22 <27`, but the initial rebuild should optimize for a single known-good runtime.

### 3.2 Language: TypeScript first

The observer, TUI, CLI, protocol, contracts, providers, hook receivers, and tests are implemented in TypeScript.

Rationale:

- The TUI is Ink/React/TypeScript, so contracts can be shared directly.
- TypeScript is faster to iterate on than Rust for the first rebuild.
- The observer can share schemas with CLI and TUI without generated bindings.
- Runtime validation can use Zod, Valibot, or similar schema tooling.
- A Rust observer remains possible later if protocol/contracts are stable.

Rust remains a future option if single-binary distribution, very low overhead, or stronger filesystem watcher semantics become more important than fast iteration.

### 3.3 Shell policy

The rebuild must not fall into the old "bunch of `.zsh` files" trap.

Allowed shell:

- Install/bootstrap shims.
- Tiny wrappers that exec the TS CLI.
- Worktrunk hook commands that call `wosm ...`.
- tmux shell snippets where the provider must run a shell command.
- Developer convenience scripts that are not part of runtime truth.

Forbidden shell:

- Large lifecycle scripts.
- Status derivation.
- Worktree orchestration logic.
- Harness-specific state machines.
- Business logic hidden in zsh functions.
- Bridge scripts that become a second backend.

Policy statement:

```text
Shell is a doorbell. TypeScript answers the door.
```

### 3.4 Terminal backend: tmux first

The reference terminal provider is tmux.

The MVP tmux implementation uses a workbench model:

```text
tmux session: wosm
  window: web / feat-auth
    pane: main agent
    optional supporting panes: shell, dev server, logs
  window: web / fix-nav
    pane: main agent
  window: api / cache-refactor
    pane: main agent
```

This means the user experiences wosm as one local workbench containing many project/worktree agent windows. The TUI can run in a popup and jump to a worktree window in the workbench.

Core wosm remains terminal-provider-neutral. The generic concept is still a `TerminalTarget`; the workbench shape is a tmux provider implementation detail.

Reasons tmux is first:

- Stable session/window/pane IDs.
- Native popups.
- Pane capture and send-keys.
- Cross-terminal behavior.
- No AppleScript or window-title matching required.
- Good fit for a workbench containing many agents.
- Allows the tmux provider to persist terminal identity bindings with tmux user options when useful.

Ghostty and other terminals can be future integrations, but tmux is the reference backend and should receive the strongest test coverage.

### 3.5 Worktree backend: Worktrunk

The WorktreeProvider calls Worktrunk instead of raw `git worktree` for normal operations.

Worktrunk responsibilities:

- Resolve branches and worktree operations.
- Create/switch/list/remove worktrees.
- Run lifecycle hooks.
- Handle advanced branch/worktree UX.

wosm responsibilities:

- Define which projects matter through config.
- Link Worktrunk worktree identity to terminal and harness identity.
- Observe and reconcile state.
- Add agent/session UX around Worktrunk.
- Install, validate, and receive wosm-specific Worktrunk hooks when configured.

Worktrunk hooks are part of the MVP integration. They should notify the observer that lifecycle-relevant worktree activity happened. They are not the source of truth; Worktrunk listing and observer reconciliation remain authoritative.

wosm should not build a separate "Worktrunk app." The actual app is `wt`, an external dependency. wosm provides a TypeScript `WorktrunkProvider` integration around that binary.

### 3.6 Harness backend: Codex first

Codex is the first HarnessProvider because it is the currently preferred/subscribed harness. OpenCode should be second.

Codex adapter responsibilities:

- Build launch commands for interactive Codex sessions.
- Optionally build non-interactive `codex exec` commands for summaries/reviews.
- Install or validate wosm-managed harness events when requested.
- Interpret hook events, process state, and pane activity into wosm statuses.
- Use conservative, confidence-based classification.
- Expose capabilities so observer and TUI do not assume Claude-style behavior.

Codex should not force the core status model to become Codex-shaped. If Codex cannot provide a reliable idle/turn-complete signal, the provider must report lower confidence or `unknown` instead of inventing certainty.

OpenCode should validate that the harness contract is not Codex-specific.

### 3.7 Runtime orchestration: Effect, selectively

wosm should use Effect where it clearly pays for itself, and high-risk runtime boundary code should make an explicit choice instead of drifting into either blanket Effect usage or blanket avoidance.

Effect is selected for high-traffic, high-failure runtime boundaries where wosm needs concurrency control, typed errors, retries, timeouts, cancellation, resource cleanup, and observable execution. It is not selected as a blanket coding style for the whole repo.

Create a small `@wosm/runtime` package that standardizes the Effect subset used by the system. This package should hide incidental Effect complexity behind wosm-shaped helpers and keep usage consistent across observer, CLI, providers, hook receivers, and TUI IO orchestration.

Standardize these V1 pieces:

```text
Effect
Cause / Exit
Context / Layer
Scope
Schedule
Queue
Logger / log annotations
Duration
runtime helpers for timeout, retry, cancellation, resource cleanup, and external commands
```

Keep these deferred or implementation-detail-only in V1:

```text
Stream
STM
full Metrics implementation
mandatory OpenTelemetry exporter
Effect Config
Effect Schema, unless it clearly beats the chosen schema tool
```

Treat these as Effect-relevant boundaries. They should usually use the shared Effect subset or a Promise/AsyncIterable facade over it, unless the implementation is simpler, easier to test, and not duplicating runtime plumbing:

- `apps/observer`
  - server lifecycle
  - command router
  - command queue
  - reconciliation loop
  - provider registry calls
  - hook ingestion
  - SQLite transaction wrappers
  - startup and shutdown handling
- `integrations/*`
  - provider boundary wrappers
  - external command execution
  - timeout and retry policy
  - provider-specific typed errors
- `apps/cli`
  - observer startup flow
  - health checks
  - hook receiver
  - doctor and debug bundle commands
- `apps/tui`
  - observer connection lifecycle
  - initial snapshot loading
  - event subscription orchestration
  - command dispatch effects
  - retry/cancel/cleanup behavior around protocol IO
  - safe error conversion at the UI boundary
- `packages/runtime`
  - shared Effect helpers
  - typed runtime wrappers
  - external command utilities
  - shutdown/cancellation helpers
- `packages/observability`
  - spans
  - structured logs
  - diagnostic context
  - redaction

Do not require Effect in:

- React/Ink presentation components.
- Pure contracts.
- Static data definitions.
- UI-only selectors that are clearer as pure functions.
- Simple config shape definitions.
- Tests that are clearer as plain `async` functions.

Policy statement:

```text
Effect is runtime orchestration infrastructure, not a whole-repo religion.
```

### 3.7.1 Effect boundary decision rubric

Effect usage is a boundary decision, not a package-wide identity. The implementing agent must not use Effect only because code lives in `apps/observer`, `apps/cli`, `apps/tui`, or `integrations/*`; it must also not avoid Effect only to keep code superficially familiar.

For each runtime boundary, choose one of these shapes:

- Effect-native internal implementation with a Promise or AsyncIterable facade.
- Effect-native implementation and Effect-native public API for internal consumers.
- Plain TypeScript or Promise implementation.

The implementing agent must make the choice explicitly when the boundary involves observer orchestration, provider calls, protocol IO, command routing, hook ingestion, external processes, SQLite transactions, lifecycle management, retries, cancellation, timeout policy, resource cleanup, queues, long-lived subscriptions, or diagnostic context.

Prefer Effect when two or more of these are true:

- The operation has multiple async steps that must be sequenced or composed.
- The operation needs timeout, retry, cancellation, interruption, or shutdown semantics.
- The operation opens or owns resources that must be cleaned up on failure or shutdown.
- The operation crosses a provider, protocol, persistence, CLI, hook, or process boundary.
- The operation needs typed error conversion plus trace/span/log context.
- The operation coordinates concurrency, fan-out, backpressure, queues, or long-lived subscriptions.

Prefer plain TypeScript when the code is pure, synchronous, presentation-only, schema-only, fixture-only, a straightforward data transform, or easier to test and read as a direct function.

Choosing plain Promise code is acceptable when it is intentionally simpler. It is not acceptable when it recreates one-off retry, timeout, cancellation, cleanup, queueing, or typed-error plumbing that should belong in the shared runtime boundary layer.

The current implementation hardening sequence for these boundaries lives in `docs/planning/effect_boundary_hardening_sequence.md`. Use that addendum when planning follow-up work that touches runtime primitives, protocol IO, observer queues, reconciliation, provider calls, CLI diagnostics, hooks, or TUI observer services.

The TUI is allowed to use Effect in service hooks and boundary modules when it needs orchestration. The TUI should not become provider-aware or backend-like, and React components should not need to understand provider mechanics to render the dashboard.

Recommended TUI boundary shape:

```text
apps/tui/src/services/observerClient.ts
  may use Effect to connect, subscribe, retry, cancel, and map errors

apps/tui/src/hooks/useObserverSnapshot.ts
  may call the service layer and expose plain UI state

apps/tui/src/components/*
  render props/state; no provider calls; no raw provider parsing
```

The protocol package may expose both forms:

```ts
export interface ObserverClient {
  health(): Promise<ObserverHealth>
  getSnapshot(options?: SnapshotOptions): Promise<WosmSnapshot>
  dispatch(command: WosmCommand): Promise<CommandReceipt>
  subscribe(filter?: EventFilter): AsyncIterable<WosmEvent>
}

export interface EffectObserverClient {
  health(): Effect.Effect<ObserverHealth, ProtocolError, RuntimeEnv>
  getSnapshot(options?: SnapshotOptions): Effect.Effect<WosmSnapshot, ProtocolError, RuntimeEnv>
  dispatch(command: WosmCommand): Effect.Effect<CommandReceipt, ProtocolError, RuntimeEnv>
  subscribe(filter?: EventFilter): Effect.Effect<AsyncIterable<WosmEvent>, ProtocolError, RuntimeEnv>
}
```

The Promise/AsyncIterable client keeps simple consumers simple. The Effect-native client is available for observer, CLI, tests, and TUI IO orchestration where it improves cancellation, retry, logging, and error mapping.

The observer command path is the best initial target:

```text
TUI dispatches command
  -> observer validates command
  -> command enters queue
  -> Effect program executes command with span/log context
  -> provider calls get timeouts, retries, and cancellation
  -> errors become typed domain errors
  -> observer maps internal error to SafeError for TUI
  -> command/event/log records are persisted
```

Example shape:

```ts
const program = Effect.gen(function* () {
  const worktree = yield* createWorktree(command)
  const terminal = yield* openTerminal(worktree)
  const run = yield* launchHarness(terminal)
  return { worktree, terminal, run }
}).pipe(
  Effect.withSpan("command.session.create"),
  Effect.retry(retryPolicy),
  Effect.catchTags({
    WorktreeProviderError: handleProviderError,
    TerminalProviderError: handleProviderError,
    HarnessProviderError: handleProviderError
  })
)
```

The rebuild should avoid two failure modes:

- No Effect: plain `async/await` spreads ad hoc retries, cancellation, logging, error conversion, and cleanup across the observer and provider boundaries.
- Too much Effect: simple components, pure data transforms, and static contracts become harder for contributors and agents to read.

The middle path is intentional: Effect at service, IO, orchestration, and provider boundaries; plain TypeScript for presentation and data shape.

### 3.8 Observability baseline

wosm must be diagnosable without a remote service. The baseline is local, structured, bounded, and safe by default.

```text
SQLite events:
  semantic command, state, and provider-observation history

JSONL logs:
  detailed runtime diagnostics for observer, CLI, TUI, providers, and hooks

Trace/span context:
  command lifecycles, provider calls, external commands, TUI IO, and reconciliation

Metrics:
  lightweight local counters and timings

Debug bundles:
  redacted artifacts that humans and AI agents can inspect quickly
```

OpenTelemetry compatibility is designed into V1 through stable trace/span IDs, operation names, and observability boundaries. OpenTelemetry export is disabled or no-op by default. Local JSONL logs, SQLite events, runtime doctor, and debug bundles are the source of diagnostic value in V1.

## 4. Monorepo and repository structure

### 4.1 Monorepo tooling

Use:

```text
pnpm workspaces     dependency graph + local package linking
Turborepo           task runner, caching, build/test orchestration
Biome               format/lint
Vitest              tests
Lefthook            git hooks
Changesets          optional; add only when publishing packages
```

The important distinction:

```text
pnpm owns packages/dependencies.
Turbo owns tasks.
Git owns history.
Lefthook protects commits.
Changesets protects releases when publishing begins.
wosm source code stays TypeScript.
```

Do not start with Nx. Nx is powerful, but wosm does not initially need its larger project model. The monorepo tooling should remain boring, explicit, and subordinate to the product architecture.

### 4.2 pnpm workspace shape

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "integrations/*/*"

# Worth considering because wosm itself may be developed with many git worktrees.
gitBranchLockfile: true
mergeGitBranchLockfilesBranchPattern:
  - main
  - release*
```

Internal dependencies should use `workspace:*` so local packages cannot accidentally resolve from npm.

Example:

```json
{
  "dependencies": {
    "@wosm/contracts": "workspace:*",
    "@wosm/protocol": "workspace:*",
    "@wosm/config": "workspace:*"
  }
}
```

### 4.3 Turborepo task graph

`turbo.json` should be simple:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

### 4.4 Recommended structure

Harnesses and terminals are integrations, not generic packages. They may each contain provider code, hook receivers, parser fixtures, scripts, command builders, and harness/terminal-specific tests.

```text
wosm/
  package.json
  pnpm-workspace.yaml
  turbo.json
  biome.json
  lefthook.yml
  tsconfig.base.json

  apps/
    observer/
      src/
        main.ts
        server.ts
        reconcile.ts
        commands.ts
        commandQueue.ts
        graph.ts
        state.ts
        persistence.ts
        diagnostics.ts
        harnessRegistry.ts
        providerRegistry.ts
        runtime.ts

    tui/
      src/
        App.tsx
        components/
        hooks/
        keybindings/
        views/

    cli/
      src/
        main.ts
        commands/
          popup.ts
          doctor.ts
          observer.ts
          hooks.ts
          snapshot.ts
          logs.ts
          debugBundle.ts

  packages/
    contracts/
      src/
        snapshot.ts
        commands.ts
        events.ts
        status.ts
        providers.ts
        ids.ts

    protocol/
      src/
        client.ts
        server.ts
        transport.ts

    config/
      src/
        loadConfig.ts
        schema.ts
        xdg.ts

    provider-testkit/
      src/
        fakeWorktree.ts
        fakeTerminal.ts
        fakeHarness.ts
        contractTests.ts

    runtime/
      src/
        effect.ts
        errors.ts
        externalCommand.ts
        shutdown.ts

    observability/
      src/
        logger.ts
        spans.ts
        diagnostics.ts
        redaction.ts
        debugBundle.ts

  integrations/
    worktree/
      worktrunk/
        provider.ts
        commands.ts
        parse.ts
        hooks.ts
        errors.ts
        fixtures/

    terminal/
      tmux/
        provider.ts
        commands.ts
        layout.ts
        popup.ts
        capture.ts
        scripts/
          popup.sh
        fixtures/

    harness/
      codex/
        provider.ts
        launch.ts
        classify.ts
        hooks.ts
        hook-receiver.ts
        parse.ts
        fixtures/

      opencode/
        provider.ts
        launch.ts
        classify.ts
        fixtures/

  scripts/
    install.sh

  examples/
    config.toml
    wt.toml

  docs/
    prd.md
    technical-design.md
    contracts.md
```

### 4.5 Import direction

- TUI imports `contracts` and `protocol`; it may also import `runtime`/`observability` in its service and IO boundary modules. It must not import integrations or provider implementation code.
- CLI imports `contracts`, `protocol`, and `config` only, except small startup helpers.
- Observer imports contracts, config, protocol server, runtime, observability, and integrations.
- Integrations import contracts/config/runtime/observability, but not apps.
- Packages do not import app-specific code.

Runtime behavior belongs in apps, packages, and integrations. Monorepo tooling is allowed to coordinate builds/tests/linting; it is not allowed to contain product logic.

---

## 5. Runtime process model and IPC

### 5.1 Lazy observer startup

The observer is a daemon in the practical sense: a background local process with no UI that stays alive while clients talk to it.

It should not be an always-on system service by default. It should be lazy:

```text
user runs `wosm`, `wosm tui`, or `wosm popup`
  -> CLI checks observer socket
  -> if observer is healthy, connect
  -> if missing/stale, start observer detached
  -> wait for health with short timeout
  -> launch TUI client
  -> observer exits after idle timeout if configured
```

Why not make it purely ephemeral?

- The TUI would have to re-scan and re-correlate everything on every launch.
- Hook events would need a durable receiver/spool anyway.
- Command logs and event logs would be fragmented.
- The TUI would slowly become the backend again.

Why not make it a heavyweight permanent service?

- wosm should remain local-first and low-friction.
- A user should not need launchd/systemd setup for normal usage.
- The observer can be started on demand and shut down when idle.

Daemon commands:

```text
wosm observer start        # starts detached local observer
wosm observer run          # foreground, useful for debugging
wosm observer stop
wosm observer restart
wosm observer status
wosm observer logs
```

### 5.2 IPC

Use a local Unix domain socket for macOS/Linux.

Default paths:

```text
$XDG_RUNTIME_DIR/wosm/observer.sock
fallback: ~/.local/state/wosm/run/observer.sock
```

Permissions:

- Socket directory: `0700`.
- Socket: user-only access.

Protocol recommendation:

- JSON-RPC-like request/response over newline-delimited JSON.
- Event subscription over the same socket after `events.subscribe`, or a second stream connection.
- Every message includes `schemaVersion`.
- Every command includes `commandId` and produces traceable events.

Example request:

```json
{"jsonrpc":"2.0","id":"req_123","method":"snapshot.get","params":{"includeDebug":false}}
```

Example response:

```json
{"jsonrpc":"2.0","id":"req_123","result":{"schemaVersion":"0.3.0","projects":[],"worktrees":[],"sessions":[]}}
```

Example event:

```json
{"schemaVersion":"0.3.0","eventId":"evt_123","type":"worktree.agentStateChanged","at":"2026-05-20T15:00:00.000Z","worktreeId":"wt_abc","agent":{"state":"needs_attention","confidence":"high"}}
```


### 5.3 Protocol, bridge, and command routing

Final V1 rejects the old bridge-file pattern. There should be no `bridge-snapshot.zsh`, no `bridge-action.zsh`, and no hidden shell transport layer. The bridge between the UI and runtime is a typed TypeScript protocol package plus the observer API.

```text
apps/tui
  -> @wosm/protocol/client
    -> local Unix socket
      -> apps/observer/server
        -> command router / graph / provider registry
```

Protocol package shape:

```text
packages/protocol/
  src/
    client.ts       # used by TUI and CLI
    server.ts       # used by observer
    transport.ts    # Unix socket / NDJSON transport
    messages.ts     # request/response/event envelopes
```

The TUI and CLI import `@wosm/contracts` and `@wosm/protocol`. They must not import concrete providers.

#### TUI read path

The TUI sees the observer in two ways:

```text
Initial render:
  TUI -> snapshot.get -> observer -> WosmSnapshot

Live updates:
  TUI -> events.subscribe -> observer -> WosmEvent stream
```

TUI boot sequence:

```text
wosm / wosm popup
  -> CLI checks observer health
  -> CLI starts observer if missing/stale
  -> CLI launches Ink TUI
  -> TUI creates ObserverClient
  -> TUI calls snapshot.get
  -> TUI subscribes to events
  -> TUI renders project/worktree rows
```

The observer translates provider truth into `WorktreeRow` objects. The TUI translates `WorktreeRow` objects into terminal UI. The TUI can sort, filter, search, collapse groups, assign slots, and render icons. It must not decide that raw terminal output means `working`, or that a raw hook payload means `needs_attention`.

Allowed TUI selectors:

```ts
selectVisibleRows(snapshot, uiState)
selectProjectGroups(snapshot, uiState)
selectCurrentAlert(snapshot)
selectKeySlots(visibleRows)
```

Forbidden TUI selectors:

```ts
deriveAgentStatusFromPaneOutput(...)
guessWorktreeStateFromPath(...)
callWtList(...)
callTmuxListPanes(...)
```

#### TUI command path

When the user presses a key, the TUI dispatches a typed command to the observer. The TUI does not call providers.

Example focus path:

```text
User presses 3
  -> TUI maps slot 3 to a worktree/session/terminal target ID from current snapshot
  -> TUI dispatches terminal.focus
  -> observer validates ID
  -> observer routes to configured TerminalProvider
  -> provider focuses the target
  -> observer emits command.started / command.succeeded or command.failed
  -> TUI updates toast/status from events
```

Example create path:

```text
TUI dispatches session.create
  -> observer validates project from config
  -> WorktreeProvider creates or opens worktree
  -> observer creates stable wosm IDs
  -> TerminalProvider opens workspace and returns terminal identity binding
  -> HarnessProvider builds launch plan
  -> TerminalProvider starts the harness command in the target
  -> observer writes SQLite records
  -> observer reconciles graph
  -> observer emits updates
  -> TUI updates
```

The observer should return a command receipt quickly:

```ts
export interface CommandReceipt {
  commandId: CommandId;
  accepted: boolean;
  status: "accepted" | "rejected";
  error?: SafeError;
}
```

Longer command progress is reported through events:

```ts
export type CommandEvent =
  | { type: "command.accepted"; commandId: CommandId; command: WosmCommand }
  | { type: "command.started"; commandId: CommandId; command: WosmCommand }
  | { type: "command.succeeded"; commandId: CommandId }
  | { type: "command.failed"; commandId: CommandId; error: SafeError };
```

#### Observer command router

The observer has one command router. It validates commands, serializes conflicting commands, logs command lifecycle, invokes providers, reconciles afterward, and emits events.

```text
apps/observer/src/
  server.ts            # protocol server
  commands.ts          # command router
  commandQueue.ts      # per-project/worktree/session serialization
  graph.ts             # current normalized graph
  reconcile.ts         # provider scan + graph diff
  providerRegistry.ts  # configured provider instances
  persistence.ts       # SQLite/event/command storage
```

Pseudo-code:

```ts
async function dispatch(command: WosmCommand): Promise<CommandReceipt> {
  validateCommand(command);
  await persistence.insertCommand(command, "accepted");
  commandQueue.enqueue(command);
  events.emit({ type: "command.accepted", commandId: command.commandId, command });
  return { commandId: command.commandId, accepted: true, status: "accepted" };
}

async function execute(command: WosmCommand): Promise<void> {
  events.emit({ type: "command.started", commandId: command.commandId, command });

  try {
    await routeCommandToProviders(command);
    await reconcile(`command:${command.type}`);
    await persistence.finishCommand(command.commandId, "succeeded");
    events.emit({ type: "command.succeeded", commandId: command.commandId });
  } catch (error) {
    const safeError = toSafeError(error);
    await persistence.finishCommand(command.commandId, "failed", safeError);
    events.emit({ type: "command.failed", commandId: command.commandId, error: safeError });
  }
}
```

#### Provider registry

Providers are typed objects inside the observer process. They are not daemons, not exposed singletons, and not imported by the TUI.

```ts
export class ProviderRegistry {
  worktree: WorktreeProvider;
  terminal: TerminalProvider;
  harnesses: Map<string, HarnessProvider>;
}
```

Example startup:

```ts
const providers = new ProviderRegistry({
  worktree: new WorktrunkProvider(config.worktree.worktrunk),
  terminal: new TmuxProvider(config.terminal.tmux),
  harnesses: [
    new CodexProvider(config.harness.codex),
    new OpenCodeProvider(config.harness.opencode),
  ],
});
```

This is an observer implementation detail. The client-facing API remains provider-neutral.

#### Hook ingestion path

Hooks are ingestion, not user commands. Hook ingestion is part of the MVP runtime, because Worktrunk and harness providers need a fast way to tell the observer that something changed.

The observer exposes a dedicated hook-ingestion method:

```ts
export interface ObserverApi {
  ingestHookEvent(event: ProviderHookEvent): Promise<HookReceipt>;
}
```

Hook path when observer is online:

```text
provider hook fires
  -> tiny command: wosm hook <provider> <event>
  -> CLI/hook receiver reads stdin/env
  -> protocol client sends observer.ingestHookEvent
  -> observer validates and persists the provider event
  -> observer schedules immediate reconciliation
  -> observer emits graph and command/event updates
```

Hook path when observer is offline:

```text
provider hook fires
  -> wosm hook <provider> <event>
  -> observer socket unavailable
  -> hook receiver validates minimally
  -> hook receiver attempts to auto-start observer
  -> if startup succeeds, hook receiver sends observer.ingestHookEvent
  -> observer schedules immediate reconciliation
  -> if startup or delivery fails, hook receiver writes JSON into spool
  -> observer drains spool on next startup/reconcile
```

Hook receivers auto-start the observer by default in MVP. This makes Worktrunk and harness hooks feel like first-class live inputs even when the TUI is closed. The auto-start path must still be nonblocking, bounded, and safe: provider hooks must not hang a user's `wt`, terminal, or harness command waiting for wosm. Startup attempts should be rate-limited, should fail closed into spool, and should record diagnostics.

Hooks are first-class notification inputs, but they are not authoritative truth. They say "something relevant happened; reconcile now." Correctness still comes from config, Worktrunk listing, terminal observations, harness observations, SQLite history, and reconciliation.

Spool files are temporary delivery records and fallback durability for failed delivery. They are not source of truth.

#### One-sentence bridge rule

```text
No runtime component except the observer may call integration providers.
```

Expanded:

```text
TUI talks only to ObserverApi.
CLI talks mostly to ObserverApi, except startup/socket management and hook receiving/auto-start/spooling.
Observer talks to providers.
Providers talk to external tools.
External tools never talk directly to TUI.
```

---

## 6. Configuration and multi-project model

### 6.1 Config is the source of truth for projects

The primary config file is TOML:

```text
~/.config/wosm/config.toml
```

The config defines projects, not every worktree. Worktrunk discovers actual worktrees inside each project.

Do this:

```text
config.toml -> web, api, mobile, wosm
Worktrunk  -> branches/worktrees under those projects
observer   -> correlated project/worktree/session graph
```

Do not do this by default:

```toml
# Avoid this as the normal source of truth.
[[projects.worktrees]]
branch = "feat-auth"
path = "..."
```

Individual worktrees change too often. Putting them in config makes the config stale and fragile.

### 6.2 Full multi-project TOML example

```toml
schema_version = 1

[observer]
auto_start = true
auto_start_from_hooks = true
idle_shutdown_minutes = 30
reconcile_interval_ms = 2000
socket_path = "~/.local/state/wosm/observer.sock"
state_dir = "~/.local/state/wosm"

[defaults]
worktree_provider = "worktrunk"
terminal = "tmux"
harness = "codex"
layout = "agent-build-shell"

[worktree.worktrunk]
command = "wt"
use_lifecycle_hooks = true
hook_mode = "required-for-mvp" # required-for-mvp | disabled
breadcrumb_location = "external" # external | worktree | provider-native | disabled

[terminal.tmux]
session_prefix = "wosm"
topology = "workbench" # workbench in MVP
workbench_session = "wosm"
window_naming = "project-branch"
primary_agent_pane = true
popup_width = "50%"
popup_height = "50%"
popup_position = "C"

[harness.codex]
enabled = true
command = "codex"
profile = "default"
sandbox_mode = "workspace-write"
approval_policy = "on-request"
install_hooks = true

[harness.opencode]
enabled = true
command = "opencode"
profile = "default"
install_hooks = true

[[projects]]
id = "web"
label = "web"
aliases = ["frontend", "site", "www"]
root = "~/projects/web"
repo = "github.com/my-org/web"
default_branch = "main"

[projects.defaults]
harness = "codex"
terminal = "tmux"
layout = "agent-build-shell"

[projects.worktrunk]
enabled = true
base = "main"

[projects.commands]
dev = "pnpm dev"
test = "pnpm test"
lint = "pnpm lint"
typecheck = "pnpm typecheck"

[projects.env]
NODE_ENV = "development"

[projects.display]
group = "work"
sort_order = 10

[[projects]]
id = "api"
label = "api"
aliases = ["backend"]
root = "~/projects/api"
repo = "github.com/my-org/api"
default_branch = "main"

[projects.defaults]
harness = "codex"
terminal = "tmux"
layout = "agent-shell"

[projects.worktrunk]
enabled = true
base = "main"

[projects.commands]
dev = "cargo run"
test = "cargo test"
check = "cargo check"

[projects.display]
group = "work"
sort_order = 20

[[projects]]
id = "mobile"
label = "mobile"
aliases = ["app"]
root = "~/projects/mobile"
repo = "github.com/my-org/mobile"
default_branch = "main"

[projects.defaults]
harness = "opencode"
terminal = "tmux"
layout = "agent-build-shell"

[projects.worktrunk]
enabled = true
base = "main"

[projects.commands]
dev = "pnpm start"
ios = "pnpm ios"
android = "pnpm android"
test = "pnpm test"

[projects.display]
group = "work"
sort_order = 30

[[projects]]
id = "wosm"
label = "wosm"
root = "~/projects/wosm"
repo = "github.com/me/wosm"
default_branch = "main"

[projects.defaults]
harness = "codex"
terminal = "tmux"
layout = "agent-shell"

[projects.worktrunk]
enabled = true
base = "main"

[projects.commands]
dev = "pnpm dev"
test = "pnpm test"
typecheck = "pnpm typecheck"

[projects.display]
group = "personal"
sort_order = 40
```

TOML note: `[[projects]]` starts a new project entry. Nested tables like `[projects.defaults]` and `[projects.commands]` belong to the most recent `[[projects]]` above them.

### 6.3 Project-local config

Project-local config is included in MVP as a minimal, explicit opt-in feature.

Global config remains authoritative for project membership. A project only becomes managed by wosm when it appears in `~/.config/wosm/config.toml`. Project-local config may supplement that project entry, but it must not silently add new projects or override sensitive machine-local policy.

Recommended global opt-in shape:

```toml
[[projects]]
id = "web"
label = "web"
root = "~/projects/web"
repo = "github.com/my-org/web"
default_branch = "main"

[projects.local_config]
enabled = true
path = ".wosm/config.toml"
trust = "explicit"
```

Recommended project-local shape:

```toml
schema_version = 1

[defaults]
layout = "agent-build-shell"
harness = "codex"

[commands]
dev = "pnpm dev"
test = "pnpm test"
typecheck = "pnpm typecheck"

[display]
group = "work"
sort_order = 10
```

Allowed MVP project-local fields:

```text
display metadata
safe command labels
layout preference
default harness preference
project-specific hook preferences that still require global/user approval
```

Disallowed MVP project-local behavior:

```text
silently adding projects
silently enabling executable hooks
overriding global security policy
overriding observer paths, socket paths, log paths, or state paths
setting secrets
changing provider binaries without explicit global approval
```

If a project-local file is missing, invalid, or untrusted, the project still appears from global config. The observer should surface the issue through `doctor`, provider health, and safe TUI status/reason text and CLI/debug-bundle output rather than failing the whole dashboard.

---

## 7. Data model

### 7.1 Graph shape

The primary graph is project-first and worktree-first:

```text
Project
  -> Worktree
       -> optional primary TerminalTarget
       -> optional primary HarnessRun
       -> derived DisplayStatus
```

A session is not the primary row. A worktree is the primary row.

MVP cardinality is intentionally simple:

```text
one worktree
  -> zero or one primary terminal target
  -> zero or one main agent run
```

A terminal layout may contain support panes, but the normal TUI does not expose those as separate rows or separate managed sessions.

This matters because the TUI must show:

- Existing worktree with no agent.
- Existing worktree with terminal open but no agent.
- Existing worktree with idle agent.
- Existing worktree with working agent.
- Existing worktree with agent needing attention.
- Existing worktree with exited/stale/unknown agent.

MVP cardinality:

```text
one worktree -> zero or one wosm-managed session
one session  -> one primary terminal workspace
one session  -> one primary agent run
one agent run -> one primary agent pane/execution target
```

A terminal provider may create supporting panes for shell, dev server, logs, or tests. Those panes are part of the provider layout and may appear in debug details. They are not separate primary agent targets in v1.

### 7.2 IDs

Stable identity is mandatory.

```ts
export type ProjectId = string;        // configured project key, e.g. web, api
export type WorktreeId = string;       // provider-specific or derived stable ID
export type SessionId = string;        // generated by wosm, e.g. ses_01HV...
export type TerminalTargetId = string; // provider-specific terminal target identifier
export type HarnessRunId = string;     // provider-specific run/thread/session ID if available
export type CommandId = string;
export type EventId = string;
```

Do not use branch names, terminal titles, or TUI row slots as durable identifiers.

### 7.3 Project

```ts
export interface ProjectConfig {
  id: ProjectId;
  label: string;
  aliases?: string[];
  root: string;
  repo?: string;
  defaultBranch?: string;
  defaults: {
    harness: string;
    terminal: string;
    layout: string;
  };
  worktrunk: {
    enabled: boolean;
    base?: string;
  };
  commands?: Record<string, string>;
  env?: Record<string, string>;
  display?: {
    group?: string;
    sortOrder?: number;
  };
}

export interface ProjectView {
  id: ProjectId;
  label: string;
  root: string;
  defaults: {
    harness: string;
    terminal: string;
    layout: string;
  };
  health: ProviderHealth;
  counts: {
    worktrees: number;
    agents: number;
    working: number;
    idle: number;
    attention: number;
    unknown: number;
  };
}
```

### 7.4 Worktree, terminal, and agent state

The observer tracks three independent dimensions.

```ts
export type WorktreeState =
  | "exists"
  | "missing"
  | "orphaned";

export type TerminalState =
  | "none"
  | "open"
  | "detached"
  | "stale"
  | "unknown";

export type AgentState =
  | "none"
  | "starting"
  | "idle"
  | "working"
  | "needs_attention"
  | "stuck"
  | "exited"
  | "unknown";
```

`active` is avoided as a main status because it is ambiguous. It could mean the worktree exists, the terminal exists, the agent process exists, or the agent is currently doing work.

### 7.5 Worktree row

The TUI primarily renders `WorktreeRow` objects.

```ts
export interface WorktreeRow {
  id: WorktreeId;
  projectId: ProjectId;
  projectLabel: string;
  branch: string;
  path: string;

  worktree: {
    state: WorktreeState;
    source: "worktrunk" | "wosm" | "manual" | "unknown";
    dirty?: boolean;
    ahead?: number;
    behind?: number;
    pr?: { number: number; url?: string };
  };

  terminal?: {
    provider: "tmux" | string;
    state: TerminalState;

    // Provider-neutral IDs. For tmux, the workspace target may be a window
    // and the primary agent target may be a pane. Other terminal providers
    // may map these concepts differently.
    workspaceTargetId?: TerminalTargetId;
    primaryAgentTargetId?: TerminalTargetId;

    sessionName?: string;
    windowId?: string;
    agentEndpointId?: string;
    attached?: boolean;
    lastOutputAt?: string;
  };

  agent?: {
    harness: "codex" | "opencode" | string;
    state: AgentState;
    pid?: number;
    runId?: HarnessRunId;
    sessionId?: SessionId;
    confidence: "high" | "medium" | "low";
    reason: string;
    updatedAt: string;
  };

  display: {
    statusLabel:
      | "no agent"
      | "starting"
      | "idle"
      | "working"
      | "needs attention"
      | "stuck"
      | "exited"
      | "unknown";
    sortPriority: number;
    alert: boolean;
    warning?: boolean;
    reason?: string;
  };
}
```


### 7.5.1 Unknown row placement

`unknown` is a normal honesty state, not automatically an alert. A row is `unknown` when the observer has evidence that a worktree, terminal target, or harness run exists, but the normalized status cannot be classified with enough confidence.

Default project-local sort order:

```text
needs_attention
stuck
working
idle
unknown
exited
no_agent
```

The TUI should keep `unknown` rows visible inside their project group, after known active states and before inactive/no-agent rows. It should not move them into a global alert section by default. The observer may still mark a specific unknown row as a warning when there is a concrete reason, such as stale terminal identity, conflicting provider observations, failed last command, or invalid hook payload.

User-facing meaning:

```text
unknown = wosm is unsure, not necessarily broken
unknown + warning = wosm is unsure and has a specific reason to draw attention
```

The observer owns the warning flag and reason. The TUI only renders them.

### 7.6 Session

A session is a wosm-correlated runtime binding between a worktree, a terminal target, and a harness run. Not every worktree has a session.

```ts
export interface SessionView {
  id: SessionId;
  projectId: ProjectId;
  worktreeId: WorktreeId;
  createdAt: string;
  updatedAt: string;

  harness: {
    provider: "codex" | "opencode" | string;
    mode: "interactive" | "exec" | "unknown";
    pid?: number;
    runId?: HarnessRunId;
    capabilities: HarnessCapabilities;
  };

  terminal: {
    provider: "tmux" | string;
    exists: boolean;
    workspaceTargetId?: TerminalTargetId;
    primaryAgentTargetId?: TerminalTargetId;
    sessionName?: string;
    sessionId?: string;
    windowId?: string;
    agentEndpointId?: string;
    attached?: boolean;
    lastOutputAt?: string;
  };

  status: ObservedStatus;
  title: string;
  tags: string[];
}
```

### 7.7 MVP terminal and agent cardinality

The MVP uses one main agent pane/endpoint per worktree.

The provider-neutral contract is:

```ts
export interface OpenWorkspaceResult {
  target: TerminalIdentityBinding; // focusable worktree terminal target
  agentEndpointId: string;         // provider-specific endpoint for launching the main agent
  providerData?: unknown;
}
```

For tmux, `agentEndpointId` maps to the main agent pane inside the worktree window. For another terminal provider, it may map to a tab, process, PTY handle, or another provider-specific endpoint. Core wosm should not care.

The TUI shows the worktree row and sends commands to the observer. It does not manage secondary panes. If the terminal provider creates shell, build, logs, or test panes, those are support panes inside the provider layout.

The MVP does not support multiple simultaneous main agents for the same worktree. That can be added later only with an explicit product decision and new tests.

### 7.7 Harness capabilities

```ts
export interface HarnessCapabilities {
  canResume: boolean;
  canReportStatus: boolean;
  canEmitHooks: boolean;
  canListSessions: boolean;
  canReceivePrompt: boolean;
  canExposeApprovalState: boolean;
  canRunNonInteractive: boolean;
}
```

Harness capabilities should be shown in debug/doctor output. They should not be assumed by the observer.

### 7.8 Observed status

```ts
export interface ObservedStatus {
  value: AgentState;
  confidence: "high" | "medium" | "low";
  reason: string;
  source:
    | "harness_hook"
    | "harness_process"
    | "terminal_capture"
    | "worktree_provider"
    | "observer_command"
    | "reconcile"
    | "unknown";
  updatedAt: string;
}
```

The TUI should display status label and reason. Confidence may be rendered subtly when useful, but deeper classification reasons belong in CLI diagnostics and debug bundles in v1.

### 7.9 Snapshot

```ts
export interface WosmSnapshot {
  schemaVersion: string;
  generatedAt: string;
  observer: {
    pid: number;
    startedAt: string;
    version: string;
    healthy: boolean;
  };
  providerHealth: Record<string, ProviderHealth>;
  projects: ProjectView[];
  rows: WorktreeRow[];
  sessions: SessionView[];
  counts: {
    projects: number;
    worktrees: number;
    agents: number;
    working: number;
    idle: number;
    attention: number;
    unknown: number;
  };
  alerts: WosmAlert[];
  orphans?: OrphanedRuntimeState[];
}
```

### 7.10 Local persistence

wosm v2 does not use `.ws`, `.ws-meta`, `.ws-*`, or shell-sourced state files as runtime source of truth.

The old file-state model is replaced by an observer-owned SQLite database plus provider reconciliation.

State ownership:

```text
config.toml
  Owns:
    configured projects
    project labels
    project roots
    defaults for harness/terminal/layout
    feature flags
    provider settings

WorktreeProvider
  Owns:
    actual worktree existence
    worktree paths
    branch/worktree lifecycle observations

TerminalProvider
  Owns:
    actual terminal target observations
    whether a target exists
    target IDs and provider-specific focus/capture/send-input behavior

HarnessProvider
  Owns:
    agent-specific launch syntax
    raw event interpretation
    process/output classification
    status confidence from harness-specific signals

observer SQLite DB
  Owns:
    wosm IDs
    command log
    event log
    last known correlations
    last known status
    provider observation cache
    recovery metadata
```

Recommended paths:

```text
~/.config/wosm/config.toml
~/.local/state/wosm/wosm.db
~/.local/state/wosm/observer.pid
~/.local/state/wosm/run/observer.sock
~/.local/state/wosm/logs/observer.jsonl
~/.local/state/wosm/spool/hooks/       # offline hook events
~/.cache/wosm/                         # non-critical cache
```

SQLite schema should start boring:

```sql
projects(
  id text primary key,
  label text not null,
  root text not null,
  repo text,
  config_hash text,
  last_seen_at text
);

worktrees(
  id text primary key,
  project_id text not null,
  path text not null,
  branch text,
  source text,
  state text,
  dirty integer,
  last_seen_at text
);

sessions(
  id text primary key,
  project_id text not null,
  worktree_id text not null,
  harness text,
  terminal_provider text,
  state text,
  created_at text,
  ended_at text,
  last_seen_at text
);

terminal_targets(
  id text primary key,
  session_id text,
  provider text not null,
  state text,
  provider_key text,
  provider_data_json text,
  last_seen_at text
);

harness_runs(
  id text primary key,
  session_id text,
  harness text not null,
  pid integer,
  external_run_id text,
  state text,
  confidence text,
  reason text,
  provider_data_json text,
  last_event_at text,
  last_seen_at text
);

commands(
  id text primary key,
  type text not null,
  payload_json text not null,
  status text not null,
  created_at text not null,
  started_at text,
  finished_at text,
  error_json text
);

events(
  id text primary key,
  type text not null,
  source text not null,
  payload_json text not null,
  created_at text not null
);

provider_observations(
  id text primary key,
  provider text not null,
  entity_key text not null,
  payload_json text not null,
  observed_at text not null,
  expires_at text
);
```

The TUI never reads SQLite directly. SQLite is internal to the observer.

Small files are still allowed for operational reasons:

```text
Allowed:
  config.toml
  observer socket
  pid file
  structured logs
  hook spool files
  optional parse-only recovery breadcrumbs

Forbidden as runtime authority:
  .ws
  .ws-meta
  .ws-*
  sourced shell state files
  scattered per-worktree authoritative status files
```

Recovery breadcrumbs default to external state under `~/.local/state/wosm/markers/` and are never required for correctness or authoritative. Provider-native metadata is preferred when a worktree provider exposes a safe metadata mechanism. In-worktree breadcrumbs are allowed only by explicit per-project opt-in. If an in-worktree marker is used, it must be parse-only JSON, must contain no secrets or prompts, must not be shell-sourced, and `wosm doctor` must report whether the marker path is ignored or intentionally tracked.

Example optional breadcrumb:

```json
{
  "schemaVersion": 1,
  "projectId": "web",
  "worktreeId": "wt_abc123",
  "sessionId": "ses_def456",
  "createdBy": "wosm",
  "createdAt": "2026-05-20T16:00:00.000Z"
}
```

If `wosm.db` is deleted, wosm should lose history and some stable correlations, but it should still rebuild a useful dashboard from config, providers, and live observations.

Hard rule:

```text
No state file may be evaluated as shell. All file-based records must be parsed as validated TOML, JSON, JSONL, or another explicit data format.
```

## 8. Observer design

### 8.1 Responsibilities

The observer is the runtime source of truth for the UI. It must be truthful but humble: it reconciles from real external systems and reports confidence.

Responsibilities:

- Maintain a normalized project/worktree/session graph.
- Accept typed commands.
- Orchestrate provider calls.
- Emit events.
- Persist command/event logs.
- Reconcile external reality.
- Expose provider health.
- Receive or spool harness/worktree hook events.

Non-responsibilities:

- Rendering UI.
- Implementing Git worktree semantics directly.
- Implementing tmux as a multiplexer.
- Owning agent internals.
- Storing model credentials.

### 8.2 How the observer sees agents and terminals

The observer does not magically know what an agent is doing. It builds a picture by correlating normalized observations from providers.

For a wosm-created session:

```text
TUI dispatches session.create
  -> observer creates stable wosm IDs
  -> observer calls WorktreeProvider to create/open the worktree
  -> observer asks TerminalProvider to create/open one primary terminal workspace
  -> TerminalProvider returns a terminal identity binding for the workspace and primary agent execution target
  -> observer asks HarnessProvider for a launch plan
  -> TerminalProvider starts the harness process in the primary agent pane/target
  -> HarnessProvider reports events/discoveries/classifications when available
  -> observer persists command/event/session records in SQLite
  -> observer reconciles and emits graph updates
  -> TUI updates
```

The generic identity environment variables are provider-neutral and can be injected into launched processes:

```text
WOSM_SESSION_ID=ses_abc123
WOSM_PROJECT_ID=web
WOSM_WORKTREE_ID=wt_xyz
WOSM_WORKTREE_PATH=/path/to/worktree
WOSM_TERMINAL_PROVIDER=tmux
WOSM_HARNESS_PROVIDER=codex
```

These are not tmux-specific or Codex-specific. They are wosm correlation hints.

#### Terminal identity binding

A terminal identity binding is provider-specific data that lets the observer correlate a terminal target with a wosm project, worktree, session, and harness run.

```ts
export interface TerminalIdentityBinding {
  provider: ProviderId;
  targetId: TerminalTargetId;
  projectId?: ProjectId;
  worktreeId?: WorktreeId;
  sessionId?: SessionId;
  harnessRunId?: HarnessRunId;
  providerData?: unknown;
  confidence: "high" | "medium" | "low";
  reason: string;
}
```

For tmux, the provider may implement this with tmux user options, pane IDs, session/window names, pane current path, environment variables, and observer DB records. Another terminal provider may implement identity binding in a different way.

Core observer code consumes the normalized binding. It must not require tmux-specific fields for correctness.

#### Harness event ingestion

Harness event ingestion is a provider-specific mechanism for accepting raw agent runtime signals and converting them into normalized wosm observations.

```ts
export interface HarnessEventObservation {
  provider: ProviderId;
  sessionId?: SessionId;
  worktreeId?: WorktreeId;
  harnessRunId?: HarnessRunId;
  status?: ObservedStatus;
  rawEventType?: string;
  providerData?: unknown;
  observedAt: string;
}
```

A harness event may come from a hook, log file, process observation, terminal output classifier, SDK callback, or another provider-specific source. The harness provider is responsible for parsing raw input and converting it into normalized observations.

Core observer code consumes normalized observations. It must not depend on harness event names, OpenCode payload shapes, or any other raw harness detail.

#### Reconciliation sources

The observer reconciles these sources:

```text
config.toml
  -> configured projects/defaults/policy

WorktreeProvider
  -> actual worktrees for each configured project

TerminalProvider
  -> terminal targets, identity bindings, liveness, optional capture

HarnessProvider
  -> discovered runs, raw event ingestion results, process status, classified status

observer SQLite DB
  -> sessions wosm created, command history, event history, last known correlations

hook spool
  -> offline provider events not yet ingested

optional recovery breadcrumbs
  -> parse-only hints for orphaned/manual state
```

The observer should always prefer live provider observations over stale database records, while using SQLite to preserve identity, history, and correlation across restarts.

### 8.3 MVP runtime shape

The MVP runtime shape is intentionally simple:

```text
Project
  -> Worktree
       -> one primary terminal focus target
            -> one main agent pane
       -> one primary harness run, when an agent is running
```

The TUI row is still a worktree row. The row's terminal action focuses the primary terminal target for that worktree. In the tmux reference provider, this primary target is the main agent pane inside the worktree's window in the global `wosm` workbench session.

Supporting panes may exist inside a terminal layout, such as a shell pane, test pane, dev-server pane, or logs pane. In the MVP, those supporting panes are terminal-provider internals. They are not separate worktree rows, not separate agent sessions, and not separate TUI focus targets unless a future feature explicitly adds an expanded view.

The MVP does not support multiple simultaneous agents in the same worktree. If a future version adds that, the data model may evolve from `primary terminal target + primary harness run` to a list of role-tagged targets/runs. Until then, one worktree means one main agent.

This keeps the product behavior easy to explain:

```text
press row key -> focus that worktree's main agent pane
start agent   -> start one main agent in that worktree
stop agent    -> stop that worktree's main agent
```

### 8.4 How the TUI sees the observer

The TUI sees the observer through a small API:

```text
snapshot.get       # current graph
events.subscribe   # live updates
command.dispatch   # typed user intent
health.get         # provider/observer health
```

The TUI receives a normalized graph:

```text
Project
  -> WorktreeRow
       -> optional primary TerminalTarget
       -> optional primary HarnessRun
       -> DisplayStatus
```

The TUI should never need to know whether status came from a harness event, terminal capture, or worktree-provider record. MVP debugging happens through CLI doctor, logs, events, and debug bundles rather than a TUI inspect panel.

Mental model:

```text
observer owns the graph
TUI owns the view
```

### 8.5 Reconciliation loop

The observer periodically reconciles:

1. Configured projects.
2. Worktrunk worktrees for those projects.
3. Terminal target state.
4. Harness process/hook state.
5. Local session records and optional recovery breadcrumbs.

Pseudo-code:

```ts
async function reconcile(reason: string): Promise<void> {
  const projects = config.projects;
  const worktrees = await worktreeProvider.listProjects(config);
  const terminalTargets = await terminalProvider.listTargets();
  const harnessRuns = await harnessRegistry.discover({ projects, worktrees, terminalTargets });

  const nextGraph = reconcileGraph({
    previous: state.graph,
    projects,
    worktrees,
    terminalTargets,
    harnessRuns,
    breadcrumbs: await readRecoveryBreadcrumbs(worktrees),
  });

  const changes = diffGraph(state.graph, nextGraph);
  state.graph = nextGraph;
  persist(changes);
  emitEvents(changes);
}
```

Reconciliation should run:

- On observer startup.
- After every command.
- On provider hook events.
- On a timer with adaptive backoff.
- When the TUI requests refresh.

### 8.6 Status derivation priority and confidence

Status must be confidence-based. The observer should never pretend to know more than the providers can actually support.

Status is derived from the best available normalized signals:

1. Recent reliable harness event, high confidence when the provider marks it reliable.
2. Harness-discovered run/process state, medium confidence unless the provider can prove stronger certainty.
3. Terminal activity/capture from the main agent pane, low to medium confidence.
4. Worktree-only state, high confidence for `no agent`, low confidence for agent activity.
5. Unknown state, low confidence when signals conflict or are incomplete.

The first harness implementation may be Codex, but this policy is not Codex-shaped. Codex, OpenCode, and future harnesses all return normalized observations with:

```text
state
confidence
reason
source
providerData
```

Example mapping:

| Signal | Worktree state | Terminal state | Agent state | Confidence |
|---|---|---|---|---|
| Worktree exists, no harness run, no terminal | exists | none | none | high |
| Worktree exists, terminal window open, no agent process | exists | open | none/exited | medium/high |
| Reliable provider event says turn complete | exists | open | idle | high |
| Reliable provider event says approval requested | exists | open | needs_attention | high |
| Reliable provider event says tool use/generation active | exists | open | working | high |
| Process alive, main agent pane changed recently | exists | open | working | low/medium |
| Process alive, no useful activity beyond threshold | exists | open | stuck | low/medium |
| Workbench window exists but main agent pane is missing | exists | stale | unknown/exited | medium |
| Worktree missing but session record exists | missing | stale/unknown | unknown | medium |
| Provider signals conflict | exists | open | unknown | low |

The mapping should be configurable per harness provider. The TUI may render confidence subtly, but debug output must expose the reason.

Default v1 posture:

```text
Prefer unknown over false idle.
Prefer unknown over false working.
Promote stronger statuses only when tests prove the provider signal is reliable.
```

### 8.7 Command execution

Commands should be serialized per worktree/session and partially parallel across different worktrees.

Command lifecycle:

```text
accepted -> running -> succeeded | failed | cancelled
```

Every command should emit:

- `command.accepted`
- `command.started`
- provider-specific progress events if useful
- `command.succeeded` or `command.failed`
- graph update events resulting from reconciliation

Safe error shape:

```ts
export interface SafeError {
  code: string;
  message: string;
  hint?: string;
  traceId: string;
}
```

Do not expose raw secrets or full environment dumps.

---

## 9. Contracts

Contracts are provider-neutral. They are deliberately simple: providers expose capabilities, return normalized observations, and hide provider-specific mechanics behind `providerData`.

### 9.1 Observer API

The TUI and CLI should only talk to the observer API.

```ts
export interface ObserverApi {
  health(): Promise<ObserverHealth>;
  getSnapshot(options?: SnapshotOptions): Promise<WosmSnapshot>;
  subscribe(filter?: EventFilter): AsyncIterable<WosmEvent>;
  dispatch(command: WosmCommand): Promise<CommandReceipt>;
  getCommand(commandId: CommandId): Promise<CommandRecord>;
  ingestHookEvent(event: ProviderHookEvent): Promise<HookReceipt>;
  runDoctor(options?: DoctorOptions): Promise<DoctorReport>;
  reconcile(reason?: string): Promise<ReconcileResult>;
}
```

The observer API is the runtime API. It is local-only by default and exposed through the protocol package.

### 9.2 WorktreeProvider

```ts
export interface WorktreeProvider {
  id: ProviderId;

  capabilities(): WorktreeCapabilities;
  health(): Promise<ProviderHealth>;
  listWorktrees(project: ProjectConfig): Promise<WorktreeObservation[]>;
  createWorktree(request: CreateWorktreeRequest): Promise<WorktreeObservation>;
  removeWorktree(request: RemoveWorktreeRequest): Promise<RemoveWorktreeResult>;
  getWorktree?(request: GetWorktreeRequest): Promise<WorktreeObservation | null>;
}

export interface WorktreeCapabilities {
  canCreate: boolean;
  canRemove: boolean;
  canList: boolean;
  canEmitLifecycleEvents: boolean;
  canExposeDirtyState: boolean;
}
```

The default implementation is `WorktrunkProvider`, which shells out to `wt` through strict TypeScript process calls and parses structured output where possible.

### 9.3 TerminalProvider

```ts
export interface TerminalProvider {
  id: ProviderId;

  capabilities(): TerminalCapabilities;
  health(): Promise<ProviderHealth>;
  listTargets(): Promise<TerminalTargetObservation[]>;
  openWorkspace(request: OpenWorkspaceRequest): Promise<TerminalTargetBinding>;
  focusTarget(targetId: TerminalTargetId): Promise<void>;
  closeTarget(targetId: TerminalTargetId): Promise<void>;
  captureTarget?(targetId: TerminalTargetId): Promise<TerminalCapture>;
  sendInput?(targetId: TerminalTargetId, input: string): Promise<void>;
}

export interface TerminalCapabilities {
  canOpenWorkspace: boolean;
  canFocusTarget: boolean;
  canCloseTarget: boolean;
  canCaptureOutput: boolean;
  canSendInput: boolean;
  canPersistIdentityBinding: boolean;
  canDisplayPopup: boolean;
}
```

Normalized observation:

```ts
export interface TerminalTargetObservation {
  id: TerminalTargetId;
  provider: ProviderId;

  projectId?: ProjectId;
  worktreeId?: WorktreeId;
  sessionId?: SessionId;
  harnessRunId?: HarnessRunId;

  state: TerminalState;
  cwd?: string;
  pid?: number;
  title?: string;

  confidence: "high" | "medium" | "low";
  reason: string;
  observedAt: string;

  providerData?: unknown;
}
```

The TUI never calls a terminal provider directly. It dispatches commands to observer.

### 9.4 HarnessProvider

```ts
export interface HarnessProvider {
  id: ProviderId;

  capabilities(): HarnessCapabilities;
  health(): Promise<ProviderHealth>;
  buildLaunch(request: BuildHarnessLaunchRequest): Promise<HarnessLaunchPlan>;
  discoverRuns(context: HarnessDiscoveryContext): Promise<HarnessRunObservation[]>;
  classifyRun(
    run: HarnessRunObservation,
    context: HarnessClassificationContext
  ): Promise<HarnessStatusObservation>;
  ingestEvent?(
    event: RawHarnessEvent,
    context: HarnessEventContext
  ): Promise<HarnessEventObservation[]>;
  stop?(request: HarnessStopRequest): Promise<HarnessStopResult>;
}

export interface HarnessCapabilities {
  canLaunch: boolean;
  canDiscoverRuns: boolean;
  canEmitEvents: boolean;
  canClassifyStatus: boolean;
  canReceivePrompt: boolean;
  canResume: boolean;
  canStop: boolean;
  canRunNonInteractive: boolean;
  canExposeApprovalState: boolean;
}
```

Normalized observation:

```ts
export interface HarnessRunObservation {
  id: HarnessRunId;
  provider: ProviderId;

  projectId?: ProjectId;
  worktreeId?: WorktreeId;
  sessionId?: SessionId;

  pid?: number;
  cwd?: string;

  state: AgentState;
  confidence: "high" | "medium" | "low";
  reason: string;
  observedAt: string;

  providerData?: unknown;
}
```

Harness providers must declare capabilities. Observer and TUI must not assume every harness exposes hooks, resumable sessions, approval state, or non-interactive execution.

### 9.5 Provider-specific data

Provider-specific data is allowed, but it must stay provider-local unless shown in debug outputs.

```ts
providerData?: unknown;
```

Rules:

- Provider-specific command syntax lives in `integrations/...`.
- Provider-specific raw payload parsing lives in `integrations/...`.
- Provider-specific metadata mechanisms live in `integrations/...`.
- Observer core consumes normalized observations and capabilities.
- TUI consumes snapshots, rows, statuses, provider labels, safe reasons, and command results.

### 9.6 Provider placement

Provider interfaces live in `packages/contracts`. Concrete providers live in `integrations/...`.

This keeps the language precise:

- `packages` are shared reusable libraries.
- `integrations` are specific, externally-shaped adapters.
- `apps` are runnable products.

## 10. Worktrunk provider design

### 10.1 WorktrunkProvider is TypeScript, not shell

The Worktrunk layer is a TypeScript integration provider that talks to the external `wt` binary.

Example shape:

```ts
class WorktrunkProvider implements WorktreeProvider {
  async listWorktrees(project: ProjectConfig): Promise<WorktreeRecord[]> {
    const result = await execa("wt", ["list", "--format=json"], {
      cwd: project.root,
      env: this.envFor(project),
    });

    return parseWorktrunkList(result.stdout, project);
  }

  async create(input: CreateWorktreeInput): Promise<WorktreeRecord> {
    const args = buildCreateArgs(input);
    const result = await execa("wt", args, {
      cwd: input.project.root,
      env: this.envFor(input.project),
    });

    return parseCreatedWorktree(result.stdout, input.project);
  }
}
```

Use strict argument arrays. Avoid stringly shell composition.

Preferred:

```ts
await execa("wt", ["switch", "--create", branch], { cwd: project.root });
```

Avoid:

```sh
# lots of clever zsh with arrays, aliases, path munging, metadata, traps...
```

### 10.2 Discovery

Use Worktrunk structured output where possible.

Preferred command shape:

```sh
wt list --format=json
```

The provider should parse worktree records into `WorktreeRecord` and attach project config context.

If Worktrunk does not support the desired structured output, the provider should isolate parsing in `integrations/worktree/worktrunk/parse.ts` with fixtures and tests.

### 10.3 Create/open

The observer should call Worktrunk to create or switch worktrees, but should not rely on Worktrunk to launch the long-running agent unless that proves simpler and controllable.

Recommended flow:

```text
observer command: session.create
  -> validate project from config
  -> worktreeProvider.create({ project, branch, base, pr })
  -> terminalProvider.openWorkspace({ sessionId, worktreePath, layout })
  -> terminalProvider returns { target, agentEndpointId }
  -> harnessProvider.buildLaunch(...)
  -> terminalProvider.sendInput(agentEndpointId, launchCommand)
```

This keeps wosm in control of session identity and lets the terminal provider return a normalized identity binding.

### 10.4 Hooks

Worktrunk hooks are part of the MVP integration.

Their job is to notify wosm that Worktrunk lifecycle activity happened, then let the observer reconcile against authoritative sources. They should not contain workflow logic or become a parallel state system.

wosm-specific Worktrunk hook usage:

- `post-start` or equivalent lifecycle event: notify observer that a worktree was created/opened externally.
- `post-switch` or equivalent lifecycle event: notify observer that a worktree became active in a user workflow, if Worktrunk exposes this distinction.
- `pre-remove`/`post-remove`: help observer prepare for and then reconcile after removal.
- Optional project hooks: remain user/project-owned unless explicitly installed by wosm.

Hook command shape:

```toml
[post-start]
wosm = "wosm hook worktrunk post-start"

[post-remove]
wosm = "wosm hook worktrunk post-remove"
```

The hook body should be tiny. It should re-enter the TypeScript CLI, which forwards/spools the event for the observer.

Rules:

```text
Hooks are part of MVP.
Hooks trigger immediate reconcile.
Hooks are not source of truth.
Polling/reconciliation still catches missed hooks.
Doctor must report missing, untrusted, or disabled wosm hooks.
```

This gives users the fast path when hooks are installed and a safe path when hooks are missed, skipped, or disabled.


#### 10.4.1 Worktrunk hook setup UX

Because Worktrunk hooks are part of MVP, wosm should not merely document hook snippets. It should provide an explicit, reversible setup flow.

Required commands:

```bash
wosm worktrunk hooks plan
wosm worktrunk hooks install
wosm worktrunk hooks uninstall
wosm worktrunk hooks doctor
```

The installer must be:

```text
idempotent
non-destructive
backup-producing
diff-previewed
explicitly confirmed
doctor-verifiable
uninstallable
```

The generated hook bodies must remain tiny. They should call the TypeScript CLI and then exit. They must not contain lifecycle logic, worktree logic, status logic, or shell-state derivation.

Example generated command body:

```bash
wosm hook worktrunk post-start
```

The plan/apply flow should describe exactly which Worktrunk config files will be changed, which hooks will be added or removed, where backups will be written, and how to undo the change. Hook installation failures must produce typed errors and appear in `wosm doctor`.

### 10.5 Worktree identity and metadata

wosm should maintain session identity in observer SQLite and provider observations, not in authoritative worktree dotfiles.

Recovery breadcrumbs are external by default and parse-only when used. Prefer provider-native metadata when available. If a project explicitly opts into in-worktree breadcrumbs, the file must be JSON, must not be shell-sourced, and must not contain secrets, full prompts, or transcripts. The breadcrumb remains a recovery hint only; provider reconciliation and SQLite state still determine runtime graph truth.

The Worktrunk provider should report worktree identity through normalized `WorktreeObservation` values. The observer then correlates those values with terminal and harness observations.

---

## 11. Terminal provider reference implementation: tmux

### 11.1 Workbench topology

MVP topology: one global tmux workbench session with one window per worktree and one main agent pane per worktree.

Example:

```text
tmux session: wosm
  window: web / feat-auth
    pane 0: main agent
    pane 1: optional shell
    pane 2: optional dev server/logs

  window: web / fix-nav
    pane 0: main agent
    pane 1: optional shell

  window: api / cache-refactor
    pane 0: main agent
```

User experience:

```text
Open wosm popup
  -> see all configured projects and worktrees
Press a row key
  -> jump to that worktree's window in the wosm workbench
```

Why workbench topology:

- Matches the desired experience: one workbench with many agents.
- Keeps all project/worktree sessions visible inside one tmux universe.
- Pairs naturally with tmux popup dashboard UX.
- Simplifies manual attach: `tmux attach -t wosm`.
- Allows window-level worktree identity while still allowing pane-level agent identity.

The tmux provider may create supporting panes, but MVP tracks one primary agent pane and one primary harness run per worktree. Multi-agent-per-worktree and deeply nested target management are future scope.

The previous alternative - one tmux session per worktree - remains a possible provider mode later, but it is not the MVP reference topology.

### 11.2 Terminal identity binding in tmux

For the tmux reference provider, terminal identity binding can be implemented with tmux user options, tmux environment, stable target IDs, pane current path, and observer SQLite records.

In the workbench topology, identity binding should be attached to the relevant tmux window and main agent pane where practical. The global `wosm` session identifies the workbench; the window identifies the worktree workspace; the main agent pane identifies the harness launch target.

Examples:

```sh
tmux set-option -w -t "$WINDOW" @wosm.session_id "$WOSM_SESSION_ID"
tmux set-option -w -t "$WINDOW" @wosm.project_id "$PROJECT_ID"
tmux set-option -w -t "$WINDOW" @wosm.worktree_id "$WORKTREE_ID"
tmux set-option -w -t "$WINDOW" @wosm.worktree_path "$WORKTREE_PATH"
tmux set-option -p -t "$MAIN_AGENT_PANE" @wosm.role "main-agent"
tmux set-option -p -t "$MAIN_AGENT_PANE" @wosm.harness "$WOSM_HARNESS"
```

The generic environment variables can also be set when launching a harness:

```text
WOSM_SESSION_ID
WOSM_PROJECT_ID
WOSM_WORKTREE_ID
WOSM_WORKTREE_PATH
WOSM_HARNESS
WOSM_TERMINAL_ROLE=main-agent
```

These implementation details belong to `integrations/terminal/tmux`. The observer consumes normalized terminal observations; the TUI consumes normalized rows.

### 11.3 Focus

Focus should prefer the worktree window inside the global workbench session. The provider may optionally select the primary agent pane when the command is agent-focused.

Inside tmux:

```sh
tmux switch-client -t "wosm"
tmux select-window -t "wosm:<worktree-window>"
tmux select-pane -t "$PRIMARY_AGENT_PANE_ID"   # only for agent-focused commands
```

Outside tmux:

```sh
tmux attach-session -t "wosm"
tmux select-window -t "wosm:<worktree-window>"
```

The provider should choose the correct path based on `TMUX` environment and client context. The observer and TUI should request `terminal.focus` using normalized target IDs, not raw tmux commands.

### 11.4 Popup

Recommended command:

```sh
wosm popup
```

Implementation options:

1. `tmux display-popup -E "wosm tui --popup"`
2. persistent `_wosm-ui` session attached inside popup
3. direct TUI process per popup open

MVP recommendation: direct TUI process per popup open, backed by warm observer. Add persistent session only if startup is too slow.

Example tmux binding:

```tmux
bind-key W display-popup -w 50% -h 50% -E "wosm tui --popup"
```

### 11.5 Pane capture

Use pane capture as a low-confidence fallback signal.

```sh
tmux capture-pane -p -t "$PANE_ID" -S -80
```

Possible uses:

- Detect recent visible output changes.
- Include recent captured output snippets in redacted debug bundles when useful.
- Identify obvious prompt/approval text when hooks are unavailable.

Do not build the primary status model on brittle text scraping. Pane capture is a terminal-provider fallback signal, not a harness truth source.

---

## 12. Harness subsystem design

### 12.1 Harnesses in relation to observer

The observer is an observer of agents, so harness state belongs inside the observer's runtime graph. Concrete harness implementation should not be embedded directly in observer core files.

Good split:

```text
apps/observer/src/harnessRegistry.ts
apps/observer/src/statusPolicy.ts

integrations/harness/codex/provider.ts
integrations/harness/codex/launch.ts
integrations/harness/codex/classify.ts
integrations/harness/codex/events.ts

integrations/harness/opencode/provider.ts
integrations/harness/opencode/launch.ts
integrations/harness/opencode/classify.ts
```

Observer core knows what a `HarnessProvider` is. Codex-specific and OpenCode-specific behavior lives in integrations.

### 12.2 Harness launch plans

The observer should not construct provider-specific shell commands directly. It asks the selected harness provider for a launch plan.

```ts
export interface HarnessLaunchPlan {
  provider: ProviderId;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  displayTitle?: string;
  providerData?: unknown;
}
```

Then the observer passes that plan to the selected terminal provider to run in the target.

```text
Observer
  -> HarnessProvider.buildLaunch(...)
  -> TerminalProvider.openWorkspace(...)
  -> TerminalProvider.sendInput(...) or launch command as part of workspace creation
```

Do not default to dangerous bypass modes. Approval and sandbox choices must be explicit in config or command payloads.

### 12.3 Harness event ingestion

Harness events improve status accuracy when a harness supports them. They are not assumed for all harnesses.

Generic path:

```text
harness lifecycle event
  -> tiny command: wosm hook <provider> <event>
  -> hook receiver reads JSON/stdin/env
  -> send ProviderHookEvent to observer socket
  -> if observer unavailable, write event to hook spool
  -> observer asks provider to ingest/classify the event
  -> observer updates graph and emits normalized events
```

Hook installation should be explicit and reversible. The hook receiver should include enough context to resolve identity when possible:

- `WOSM_SESSION_ID` environment variable if present.
- Current working directory.
- Provider-specific run/thread/session ID if exposed.
- Raw event type.
- Timestamp.

Provider-specific raw event shapes must not leak into observer core or TUI code.

### 12.4 Codex provider notes

Codex is the first harness provider, not a core primitive.

Codex provider responsibilities:

- Health check command.
- Build interactive launch plans.
- Build optional non-interactive launch plans for future commands.
- Interpret Codex-specific events or output when available.
- Classify status conservatively with confidence and reason.
- Prefer `unknown` or lower confidence over false `idle`/`working` certainty.
- Keep Codex-specific command flags, config details, hook payloads, and output parsing inside `integrations/harness/codex`.

Interactive launch should run in the worktree. Example shape only:

```sh
codex --cd "$WOSM_WORKTREE_PATH"
```

Optional config-driven values:

```text
model
profile
approval policy
sandbox mode
additional writable directories
initial prompt
```

MVP should focus on interactive sessions. Non-interactive execution can support future summaries, reviews, or one-shot analysis.

Codex v1 status policy:

```text
High confidence:
  no agent
  starting
  exited
  terminal missing/stale
  needs_attention when a reliable provider event says so

Medium confidence:
  working from recent reliable activity, active process, or terminal output movement

Low confidence:
  idle inferred from lack of activity
  unknown when signals conflict or are incomplete
```

This is intentional. A dashboard that admits uncertainty is better than one that lies. Richer Codex status can be promoted only after scripted and real agent-driven tests prove it.

### 12.5 OpenCode provider notes

OpenCode should be the second harness adapter.

MVP for OpenCode provider:

- Health check command.
- Launch interactive OpenCode in a terminal target.
- Declare conservative capabilities.
- Use process and terminal activity for status initially.
- Add hooks/API integration only if stable.

Do not let OpenCode assumptions leak into the generic harness contract.

## 13. TUI design

### 13.1 TUI responsibilities

The Ink TUI should:

- Connect to observer.
- Render project/worktree/session snapshot.
- Subscribe to events.
- Dispatch commands.
- Maintain ephemeral UI state.

The TUI should not:

- Run `wt`, `tmux`, `codex`, or `opencode` directly for core features.
- Parse provider output.
- Decide true session status.
- Store durable session metadata.

### 13.2 Project-first layout

The TUI should show configured projects and every Worktrunk worktree in those projects, not just active agent sessions.

Recommended main view:

```text
wosm                                  4 projects | 9 worktrees | 3 working | 1 attention
-----------------------------------------------------------------------------------------
web                                  4 worktrees | codex
[1] ! feat-auth-refresh       codex     working           18m      tmux
[2] . fix-nav-mobile          codex     idle              42m      tmux
[3] . pr-1842-review          -         no agent          -        -
[4] ! checkout-copy           codex     needs attention   7m       tmux

api                                  2 worktrees | codex
[5] > cache-refactor          codex     working           11m      tmux
[6] . main                    -         no agent          -        -

mobile                               2 worktrees | opencode
[7] . nav-bug                 opencode  idle              1h       tmux
[8] . ios-build-fix           -         no agent          -        -

wosm                                 1 worktree | codex
[9] > observer-refactor       codex     working           23m      tmux
-----------------------------------------------------------------------------------------
n:new  s:start agent  f:focus  o:open shell  x:remove  c:close  /:search  r:refresh  ?:help
```

A row represents a worktree. It may or may not have a session.

### 13.3 Required visible states

The TUI must distinguish at least:

```text
no agent
idle
working
needs attention
stuck
exited
unknown
```

Definitions:

- `no agent`: worktree exists, no known harness run is attached.
- `idle`: agent is open and available but not currently working.
- `working`: agent is actively generating, executing tools, or otherwise processing a task.
- `needs attention`: agent needs approval, input, or another human action.
- `stuck`: agent appears alive but no useful progress has occurred beyond a threshold.
- `exited`: agent or terminal exited and can be restarted.
- `unknown`: observer cannot classify state honestly.

### 13.4 Unknown row placement

Unknown rows stay visible inside their project group. They are not top-level alerts by default and should not be hidden in debug-only views. Unknown means wosm is being honest about uncertainty, not necessarily that something is broken.

Recommended default sort order inside a project group:

```text
needs attention
stuck
working
idle
unknown
exited
no agent
```

A specific unknown row may still carry a warning if the observer has evidence of a real problem, such as a stale terminal target, conflicting provider signals, or a failed recent command. In that case the row can show a warning reason, but unknown by itself is not an alert.

### 13.5 Default actions by row state

```text
no agent:
  start agent
  open terminal/shell
  remove worktree

idle:
  focus terminal
  stop agent
  remove worktree with confirmation

working:
  focus terminal
  stop agent with confirmation
  remove disabled or heavily guarded

needs attention:
  focus terminal
  show reason from snapshot
  stop agent with confirmation

exited:
  restart agent
  open terminal
  remove worktree

unknown:
  focus terminal if known
  reconcile
  create debug bundle from CLI when deeper investigation is needed
```

### 13.6 Command prompts

Prompt flows:

- New worktree/session: project -> branch/task/PR -> harness -> optional prompt -> confirm.
- Start agent in existing worktree: select worktree -> harness -> launch/focus.
- Open/focus existing terminal: select row -> focus.
- Remove: select worktree/session -> dirty warning -> confirm.
- Close: select session -> close harness/terminal/all -> confirm if destructive.

Each prompt dispatches one typed command to observer. The v1 TUI does not include a row inspect/debug panel; deeper debugging goes through `wosm doctor`, `wosm debug bundle`, `wosm snapshot --json`, and related CLI tools.

### 13.7 Optimistic UI

The TUI may show optimistic toasts such as `creating...`, but session truth comes from observer events and snapshots.

If a command fails, the TUI should show:

- human-readable message
- hint if available
- trace ID
- command retry option if safe

---



### 13.8 Prompt delivery policy

The v1 TUI focuses idle agents; it does not auto-send prompts to already-running agents.

When a row has an idle agent, the primary action is to focus the terminal target so the user can type directly into the agent pane. This keeps v1 safe and avoids accidental prompt delivery into the wrong pane, wrong worktree, or wrong harness state.

Reserved future behavior:

```text
session.sendPrompt
paste-and-focus
harness-native prompt delivery
```

`session.sendPrompt` may remain in the command contracts as a reserved command, but the TUI must hide or disable it unless the selected harness provider declares safe prompt delivery through capabilities. Terminal-level keystroke simulation should not be used as an unguarded v1 prompt-send mechanism.

`initialPrompt` during new session creation is a separate launch-time concern. It may be supported when the harness provider can safely include an initial prompt in its launch plan.

---

## 14. Commands and events

### 14.1 Command union

```ts
export type WosmCommand =
  | { type: "worktree.create"; payload: CreateWorktreePayload }
  | { type: "worktree.remove"; payload: RemoveWorktreePayload }
  | { type: "session.create"; payload: CreateSessionPayload }
  | { type: "session.startAgent"; payload: StartAgentPayload }
  | { type: "terminal.focus"; payload: { targetId?: TerminalTargetId; sessionId?: SessionId; worktreeId?: WorktreeId } }
  | { type: "session.close"; payload: { sessionId: SessionId; mode: "harness" | "terminal" | "all" } }
  | { type: "session.remove"; payload: { sessionId: SessionId; removeWorktree: boolean; force?: boolean } }
  | { type: "session.sendPrompt"; payload: { sessionId: SessionId; prompt: string; delivery?: "harness-native" | "paste-and-focus" } }
  | { type: "observer.reconcile"; payload: { reason?: string } }
  | { type: "hooks.install"; payload: { provider: string } };
```

The observer must reject `session.sendPrompt` in v1 unless the target harness declares safe prompt delivery support. The TUI should not expose this command by default.

### 14.2 Create session payload

```ts
export interface CreateSessionPayload {
  projectId: ProjectId;
  branch: string;
  base?: string;
  source?: { kind: "branch" | "pr" | "manual"; value: string };
  harness: {
    provider: "codex" | "opencode" | string;
    mode?: "interactive" | "exec";
    profile?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
  };
  terminal: {
    provider: "tmux" | string;
    layout?: "default" | "agent-only" | "agent-build-shell";
    focus?: boolean;
  };
  initialPrompt?: string;
}
```

### 14.3 Start agent payload

```ts
export interface StartAgentPayload {
  projectId: ProjectId;
  worktreeId: WorktreeId;
  harness: {
    provider: "codex" | "opencode" | string;
    mode?: "interactive" | "exec";
    profile?: string;
  };
  terminal?: {
    provider?: "tmux" | string;
    layout?: "default" | "agent-only" | "agent-build-shell";
    focus?: boolean;
  };
  initialPrompt?: string;
}
```

### 14.4 Event union

```ts
export type WosmEvent =
  | { type: "observer.started"; at: string }
  | { type: "observer.reconciled"; at: string; changed: number }
  | { type: "project.updated"; projectId: ProjectId }
  | { type: "worktree.added"; row: WorktreeRow }
  | { type: "worktree.updated"; worktreeId: WorktreeId; patch: Partial<WorktreeRow> }
  | { type: "worktree.removed"; worktreeId: WorktreeId }
  | { type: "worktree.agentStateChanged"; worktreeId: WorktreeId; agent: WorktreeRow["agent"] }
  | { type: "session.created"; session: SessionView }
  | { type: "session.updated"; sessionId: SessionId; patch: Partial<SessionView> }
  | { type: "session.removed"; sessionId: SessionId }
  | { type: "command.started"; commandId: string; command: WosmCommand }
  | { type: "command.succeeded"; commandId: string }
  | { type: "command.failed"; commandId: string; error: SafeError }
  | { type: "provider.healthChanged"; provider: string; health: ProviderHealth };
```

---

## 15. CLI design

### 15.1 CLI commands

The CLI is the user's command surface and the startup path into the observer/TUI.

Recommended commands:

```text
wosm                         # start/connect observer and open TUI
wosm tui                     # explicit TUI
wosm popup                   # open tmux popup
wosm doctor                  # check config/tools/providers
wosm snapshot --json         # print observer snapshot
wosm logs                    # tail observer logs
wosm reconcile               # request immediate reconcile

wosm observer start
wosm observer run
wosm observer stop
wosm observer restart
wosm observer status
wosm observer logs

wosm hooks install codex
wosm hooks install worktrunk
wosm hooks uninstall codex
wosm hook codex <event>      # hook receiver entrypoint
wosm hook worktrunk <event>  # hook receiver entrypoint
```

### 15.2 CLI boundaries

The CLI can:

- Start observer.
- Connect to observer.
- Forward hook events.
- Print data for humans/debugging.
- Launch TUI/popup.

The CLI cannot:

- Maintain the runtime graph.
- Derive true status.
- Implement worktree lifecycle.
- Hide integration logic in ad-hoc scripts.

---

## 16. Security model

### 16.1 Local-only boundary

The observer should listen only on a local user-owned socket. No TCP listener by default.

### 16.2 Command safety

- Destructive commands require confirmation in TUI.
- Worktree removal checks dirty state.
- Provider commands are logged with redaction.
- Dangerous Codex flags are opt-in only.
- Hook installation is explicit.

### 16.3 Secret handling

wosm should not persist:

- API keys.
- Access tokens.
- Full prompts by default.
- Agent transcripts by default.
- Environment dumps.

Logs should redact common secret patterns and avoid full provider environment output.

### 16.4 Hook trust

Codex, OpenCode, and Worktrunk hooks can run scripts. wosm should:

- Show hook files/config entries it intends to install.
- Provide uninstall.
- Avoid overwriting unrelated hooks.
- Prefer appending a small receiver command or config entry.
- Auto-start the lazy local observer when a hook fires and the observer is offline. Spool events only when startup or delivery fails.

---

## 17. Error handling and Effect boundary policy

wosm needs robust errors because most failures happen at boundaries: local sockets, external CLIs, terminal providers, harness providers, Worktrunk, hooks, filesystem state, SQLite, and user configuration.

The policy is:

```text
All runtime errors crossing app, provider, protocol, persistence, or command boundaries must be converted into typed wosm errors.
```

Effect should be used to make those errors explicit in the highest-risk runtime paths. Plain thrown errors from provider code, child processes, JSON parsing, SQLite, filesystem calls, or protocol handling should be converted at the boundary into domain errors.

### 17.1 Error taxonomy

Internal runtime errors should use tagged categories.

```ts
type WosmError =
  | ConfigError
  | ProtocolError
  | CommandValidationError
  | CommandExecutionError
  | ProviderUnavailableError
  | ExternalCommandError
  | WorktreeProviderError
  | TerminalProviderError
  | HarnessProviderError
  | HookIngestionError
  | ReconcileError
  | PersistenceError
  | TimeoutError
  | CancellationError
  | PermissionError
```

Recommended code prefixes:

| Code prefix | Meaning |
|---|---|
| `CONFIG_*` | Missing or invalid config |
| `PROTOCOL_*` | Socket, request, schema, or transport errors |
| `OBSERVER_*` | Startup, health, lifecycle, or graph errors |
| `PERSISTENCE_*` | SQLite or state persistence errors |
| `WT_*` | Worktree provider errors |
| `TERMINAL_*` | Terminal provider errors |
| `HARNESS_*` | Harness provider errors |
| `HOOK_*` | Hook ingestion or spool errors |
| `COMMAND_*` | Command validation or execution errors |
| `RECONCILE_*` | State reconciliation errors |
| `EXTERNAL_*` | External command execution errors |
| `TIMEOUT_*` | Timeout errors |
| `CANCELLED_*` | Cancellation/interruption errors |

### 17.2 Internal error envelope

The observer should persist rich internal error records for debugging and diagnostic bundles.

```ts
export interface ErrorEnvelope {
  id: string
  tag: string
  code: string
  message: string
  severity: "debug" | "info" | "warn" | "error" | "fatal"
  commandId?: string
  traceId?: string
  spanId?: string
  projectId?: string
  worktreeId?: string
  sessionId?: string
  provider?: string
  cause?: unknown
  stack?: string
  raw?: unknown
  redacted: boolean
  createdAt: string
}
```

This internal envelope may contain stack traces, provider-specific data, external command stderr snippets, and raw payload fragments after redaction. It is not sent directly to the TUI.

### 17.3 SafeError for TUI and CLI output

User-facing errors are converted to `SafeError` before crossing the protocol boundary.

```ts
export interface SafeError {
  tag: string
  code: string
  message: string
  hint?: string
  commandId?: string
  projectId?: string
  worktreeId?: string
  sessionId?: string
  provider?: string
  traceId?: string
  diagnosticId?: string
}
```

Example:

```json
{
  "tag": "TerminalProviderError",
  "code": "TERMINAL_TARGET_MISSING",
  "message": "The terminal target for this worktree no longer exists.",
  "hint": "Refresh the dashboard or reopen the worktree.",
  "provider": "tmux",
  "traceId": "trc_123",
  "diagnosticId": "diag_2026_05_20_001"
}
```

The TUI should show concise errors, diagnostic IDs, and safe hints. Deeper details are exposed through CLI diagnostics and debug bundles. The TUI must not render raw stacks, raw provider payloads, secrets, unredacted environment variables, or unredacted command output by default.

### 17.4 Boundary conversion points

Errors must be converted at these boundaries:

- Protocol request parse/validation.
- Observer command validation.
- Command queue execution.
- Provider method calls.
- External process execution.
- Hook ingestion.
- Hook spool read/write.
- SQLite transactions.
- Config parsing.
- Snapshot generation.
- Event stream delivery.
- Startup/shutdown.

Boundary wrappers should attach context:

```ts
await observe.providerCall("worktrunk.listWorktrees", context, () =>
  worktreeProvider.listWorktrees(project)
)

await observe.externalCommand("tmux", args, context, () =>
  execFile("tmux", args)
)
```

When implemented with Effect, the same boundary should attach spans, logs, retry policy, timeout policy, and typed error mapping in one place.

### 17.5 Error handling rule

```text
Providers may know provider-specific error details.
Observer core may know typed normalized errors.
TUI may know SafeError only.
SQLite may store redacted internal ErrorEnvelope records.
```

---

## 18. Observability, logging, and diagnostics

wosm must be diagnosable by humans and by coding agents. Since wosm itself manages coding agents, the system should make failures easy for those agents to inspect.

The goal is not to scatter `log this` and `log that` through every file. The goal is structured observability at boundaries.

### 18.1 Observability model

wosm records five kinds of diagnostic data:

```text
Structured JSONL logs
  detailed runtime diagnostics

Durable SQLite events
  semantic command and state history

Trace/span context
  execution flow and timing for commands/provider calls

Metrics
  lightweight counters and timings for runtime health

Diagnostic bundles
  redacted snapshots of recent state for humans and agents
```

Logs are diagnostic data, not source of truth. The observer graph and provider reconciliation remain the source of current runtime state.

### 18.2 Log files

Default files:

```text
~/.local/state/wosm/
  wosm.db

  logs/
    observer.jsonl
    cli.jsonl
    tui.jsonl
    hooks.jsonl

  diagnostics/
    diag_2026-05-20T120000Z.json

  spool/
    hooks/
      *.json
```

Defaults:

```text
default log level: info
debug level: opt-in
trace level: short-lived, opt-in
rotation: 10 files per component
max file size: 10-25 MB
redaction: always on
```

The log schema should be stable enough for agents to parse.

```ts
export interface LogRecord {
  timestamp: string
  level: "debug" | "info" | "warn" | "error"
  component: "observer" | "cli" | "tui" | "hook" | "provider"
  message: string
  traceId?: string
  spanId?: string
  commandId?: string
  projectId?: string
  worktreeId?: string
  sessionId?: string
  provider?: string
  attributes?: Record<string, unknown>
}
```

### 18.3 Events versus logs

SQLite events are semantic records. Logs are runtime diagnostics.

Examples of events:

```text
command.accepted
command.started
command.succeeded
command.failed
project.updated
worktree.added
worktree.removed
terminal.targetChanged
harness.runObserved
worktree.agentStateChanged
hook.ingested
hook.spoolDrained
reconcile.completed
```

Examples of logs:

```text
Starting observer on socket path ...
Worktrunk listWorktrees completed in 43ms
Provider call timed out; retrying once
Drained 4 hook spool files
Converted ExternalCommandError to SafeError
```

Events are useful for snapshots, history, and debugging state transitions. Logs are useful for understanding why a runtime operation behaved the way it did.

### 18.4 Shared observability wrappers

Avoid log soup by instrumenting boundary wrappers instead of scattering ad hoc logging.

Recommended wrappers:

```ts
observe.command(name, context, fn)
observe.providerCall(name, context, fn)
observe.externalCommand(binary, args, context, fn)
observe.protocolRequest(method, context, fn)
observe.reconcile(reason, context, fn)
observe.hookIngestion(provider, context, fn)
observe.sqliteTransaction(name, context, fn)
```

These wrappers should:

- Start a span.
- Attach trace IDs and command IDs.
- Log start/finish/failure at appropriate levels.
- Record duration.
- Convert errors to typed envelopes.
- Apply redaction.
- Persist relevant events.

Effect can provide the runtime structure for these wrappers in observer and provider code. Non-Effect callers can still use wrapper APIs that return Promises.

### 18.5 Provider health and reconcile timing

The observer should track provider health as part of the snapshot.

```ts
export interface ProviderHealth {
  providerId: string
  providerType: "worktree" | "terminal" | "harness"
  status: "healthy" | "degraded" | "unavailable" | "unknown"
  lastCheckedAt: string
  lastError?: SafeError
  latencyMs?: number
  capabilities?: Record<string, boolean>
}
```

The observer should also record reconciliation timing:

```ts
export interface ReconcileTiming {
  reason: string
  startedAt: string
  finishedAt: string
  durationMs: number
  projectsScanned: number
  worktreesObserved: number
  terminalTargetsObserved: number
  harnessRunsObserved: number
  eventsEmitted: number
  errors: SafeError[]
}
```

This helps answer questions such as:

- Is Worktrunk slow?
- Is the terminal provider unavailable?
- Is a harness provider failing to classify status?
- Did hook spool replay change state?
- Is the observer spending too much time scanning projects?

### 18.6 Metrics

Metrics should be lightweight and local-first. They should help answer what is slow, stuck, noisy, or failing without requiring a metrics backend.

Initial useful metrics:

```text
observer uptime
active TUI clients
command count by type/status
command duration by type
reconcile duration and result counts
provider call duration by provider/method
provider error count by provider/error tag
hook ingestion count and failure count
hook spool depth
external command duration and failure count
SQLite transaction duration and failure count
```

Metrics can be surfaced through `wosm observer status`, `wosm doctor`, debug bundles, and optional JSON snapshots. They should not require a remote collector in v1.



### 18.7 Runtime doctor

`wosm doctor` is a required runtime diagnostic command before dog, notification, or other polish work begins.

The minimum acceptable MVP doctor is a runtime doctor, not just a dependency checker. It should report:

```text
observer status, socket, pid, and version
SQLite state and migration status
config parse result and project count
project-local config enabled/missing/invalid/untrusted status
provider binary availability and versions where available
Worktrunk hook installation and trust status
tmux workbench session status for the reference provider
harness provider availability and capabilities
current snapshot summary
unknown/stale/orphan row counts
hook spool depth and recent hook failures
log paths
recent errors
debug bundle command availability
```

A deeper simulation doctor can come later as `wosm doctor --deep`. The MVP requirement is that a user or agent can run one command and understand the health of the configured runtime.

Dog, notification, and other polish features should not be prioritized until the runtime doctor can explain common setup and provider failures.

### 18.8 Debug bundle

`wosm debug bundle` is a core feature, not an afterthought.

It must exist before the first real provider integration ships. The first useful implementation should work against fake providers and injected failures so diagnostic expectations are locked before Worktrunk, tmux, Codex, or OpenCode complexity arrives.

Example commands:

```bash
wosm debug bundle
wosm debug bundle --last 30m
wosm debug bundle --project web
wosm debug bundle --command cmd_123
```

Minimum V1 bundle contents:

```text
manifest.json
  wosm version
  bundle created_at
  selected time window
  OS/platform
  Node/pnpm versions
  redaction policy version

config-summary.json
  redacted global config
  configured projects
  project-local config status
  validation errors and warnings

observer-health.json
  pid/socket status
  uptime
  SQLite status
  migration version
  command queue status
  reconcile timing summary

snapshot.json
  latest normalized snapshot
  projects, worktrees, rows, counts, alerts, provider health
  no unredacted provider secrets

provider-health.json
  registered providers
  fake or real provider status
  binary/version checks where available

commands.jsonl
  recent command records
  command IDs
  status transitions
  safe errors

events.jsonl
  recent normalized events

errors.jsonl
  recent typed error envelopes

logs/
  observer.jsonl
  cli.jsonl
  hook-runner.jsonl
  tui.jsonl when available

spool-summary.json
  pending hook events
  failed deliveries
  oldest/newest spool item

redaction-report.json
  fields/classes removed
  suspicious secret patterns found and redacted

README.txt
  how to inspect the bundle
  suggested next commands
```

The bundle should be optimized for AI-agent debugging. A future agent should be able to read the bundle and quickly answer: what failed, which provider failed, what command caused it, what state was expected, what state was observed, and what the user can do next.

A real provider is not considered shippable until its failures appear clearly in `wosm debug bundle` output.

### 18.9 OpenTelemetry posture

OpenTelemetry should be designed for but disabled by default in V1.

The V1 baseline is:

```text
local JSONL logs
SQLite events
trace/span IDs inside local records
stable operation names
redacted debug bundles
runtime doctor output
```

Operation names should be stable enough to map to OpenTelemetry later:

```text
command.session.create
command.session.startAgent
command.terminal.focus
provider.worktrunk.listWorktrees
provider.worktrunk.createWorktree
provider.tmux.openWorkspace
provider.tmux.focusTarget
provider.codex.discoverRuns
hook.worktrunk.ingest
hook.harness.ingest
observer.reconcile
sqlite.transaction
protocol.request
```

If OpenTelemetry is added, it should export from the same observability layer. Application code should not be rewritten to emit vendor-specific telemetry.

### 18.10 Retention and local state limits

Diagnostic data must be useful without growing forever.

Default retention should be balanced:

```toml
[observability.retention]
max_days = 14
max_total_mb = 250
max_file_mb = 10
max_files_per_component = 5

[observability.retention.components]
observer_max_mb = 100
cli_max_mb = 25
tui_max_mb = 25
hook_runner_max_mb = 25
provider_max_mb = 75

[observability.retention.sqlite]
events_max_days = 30
commands_max_days = 60
errors_max_days = 60
provider_observations_max_days = 14

[observability.retention.debug_bundles]
max_bundles = 10
max_days = 30

[observability.retention.hook_spool]
delivered_delete_immediately = true
failed_max_days = 7
failed_max_items = 1000
```

`wosm doctor` should report local state usage:

```text
Local state
  total: 42 MB / 250 MB
  logs: 18 MB
  database: 12 MB
  debug bundles: 10 MB
  hook spool: 0 pending
```

Retention rules are configurable, but the default posture is bounded by both age and size. Logs, debug bundles, and provider observations are diagnostic data, not runtime truth.

### 18.11 Observability rule

```text
Every boundary is observable.
No raw provider payload crosses into the TUI.
No secret is logged by default.
Logs are diagnostic data, not runtime truth.
wosm debug bundle must make failures agent-debuggable.
```

## 19. Testing strategy and test architecture

Testing is part of the architecture of wosm, not a final-phase quality pass.

Wosm is a local developer-infrastructure system. It coordinates a lazy observer daemon, a TUI, a CLI, provider integrations, external processes, local sockets, SQLite persistence, hook ingestion, terminal targets, worktrees, and agent runs. A project like this cannot be made reliable by manual testing alone.

The testing system must be designed up front and kept organized from the first commit.

### 19.1 Testing principles

Core principles:

```text
Tests are written before implementation for each development slice.
Tests may run red during the local red-green-refactor loop.
The main branch must not remain red.
Every provider boundary gets contract tests.
Every runtime boundary gets error and observability tests.
Every major command gets lifecycle tests.
Every diagnosable failure gets a debug-bundle test.
True agent-driven tests exist from the start, first with scripted agents and later with real agents.
```

The purpose of testing is not only to prove correctness. It is also to create stable seams so future coding agents can safely modify the system.

The companion phased-development document defines which tests are expected to be red at the beginning of each phase and what makes them green.

### 19.2 Test taxonomy

Wosm uses these test tiers.

```text
contract tests
  Validate public schemas, protocol messages, provider contracts, command payloads,
  event payloads, SafeError envelopes, and snapshot fixtures.

unit tests
  Validate pure functions, parsers, selectors, status policy, config loading,
  command validation, redaction, and graph derivation.

integration tests
  Validate one app or provider boundary at a time, usually with fake external
  tools or controlled fixtures.

e2e tests
  Validate a real observer process, protocol client, SQLite state, and TUI/CLI
  flows using fake providers or optional real providers.

diagnostic tests
  Inject known failures and verify logs, events, SafeErrors, provider health,
  reconcile timing, and debug bundles contain enough context to diagnose them.

scripted-agent tests
  Launch a deterministic fake agent through a harness provider contract and
  validate lifecycle, observation, file changes, events, and diagnostics.

real-agent tests
  Launch a real supported harness, such as Codex or OpenCode, in an isolated
  sandbox project. These are opt-in and must not block normal local development.
```

### 19.3 Red-first development rule

For each phase and each meaningful feature slice:

```text
1. Write or update the relevant tests first.
2. Run the targeted suite and confirm the new tests fail for the expected reason.
3. Implement the smallest coherent slice.
4. Run the targeted suite until green.
5. Run the required phase gate.
6. Merge only when the phase gate is green.
```

This means tests should run red during local development. It does not mean the repository should keep broken tests on the main branch.

### 19.4 Required test command surface

The root repository must expose a stable test command surface.

```text
pnpm test:unit
pnpm test:contracts
pnpm test:integration
pnpm test:e2e
pnpm test:diagnostics
pnpm test:agent:scripted
pnpm test:agent:real
pnpm test:all
```

Recommended supporting commands:

```text
pnpm test:watch
pnpm test:changed
pnpm test:providers
pnpm test:tui
pnpm test:observer
pnpm test:debug-bundle
```

`test:agent:real` must be opt-in. It may require local credentials, local subscriptions, external CLIs, and network access. Normal CI must be able to run without it.

### 19.5 CI and local gates

Recommended gates:

```text
pre-commit
  Biome formatting/linting for staged files.
  Targeted unit tests where practical.

pre-push
  unit tests
  contract tests
  selected integration tests

standard CI
  typecheck
  lint
  unit tests
  contract tests
  integration tests
  scripted-agent tests
  diagnostic tests

extended CI
  e2e tests
  real tmux tests where the runner supports tmux
  persistence/restart tests

manual or nightly
  real-agent tests
  chaos/recovery tests
  agent-diagnosis tests
```

The standard CI lane must not depend on real model behavior, network availability, active subscriptions, or real developer terminals.

### 19.6 Test folder policy

Tests must live in predictable locations. Random floating test files are not allowed.

Unit and local integration tests live inside the workspace they validate. Cross-system tests live in the top-level `tests/` directory.

Recommended structure:

```text
wosm/
  apps/
    observer/
      src/
      test/
        unit/
        integration/
        fixtures/

    cli/
      src/
      test/
        unit/
        integration/
        fixtures/

    tui/
      src/
      test/
        unit/
        integration/
        fixtures/

  packages/
    contracts/
      src/
      test/
        schema/
        fixtures/

    protocol/
      src/
      test/
        unit/
        integration/
        fixtures/

    config/
      src/
      test/
        unit/
        fixtures/

    observability/
      src/
      test/
        unit/
        fixtures/

  integrations/
    worktree/
      worktrunk/
        src/
        test/
          unit/
          integration/
          fixtures/

    terminal/
      tmux/
        src/
        test/
          unit/
          integration/
          fixtures/

    harness/
      codex/
        src/
        test/
          unit/
          integration/
          fixtures/

      opencode/
        src/
        test/
          unit/
          integration/
          fixtures/

  tests/
    support/
      fake-worktree-provider/
      fake-terminal-provider/
      fake-harness-provider/
      fake-agent/
      fake-external-tools/
      temp-projects/
      assertions/
      db/
      sockets/

    e2e/
      observer-protocol/
      tui-observer/
      full-session-lifecycle/
      recovery/

    agent/
      scripted/
      real/
      scenarios/
      fixtures/
      oracles/
      reports/

    diagnostics/
      debug-bundle/
      injected-failures/
      redaction/

    contract-fixtures/
      snapshots/
      commands/
      events/
      provider-observations/
      errors/
```

When a test validates only one workspace, it belongs with that workspace. When a test validates multiple apps or providers together, it belongs under top-level `tests/`.

### 19.7 Fixture policy

Fixtures are required for contracts, providers, and diagnostics.

Fixture rules:

```text
Fixtures must be small and readable.
Fixtures must not contain real secrets, account names, tokens, or private repo paths.
Provider fixtures must include both valid and invalid examples.
Every fixture that crosses a public boundary must validate against a schema.
Diagnostic fixtures must include realistic failure metadata and redaction cases.
```

Recommended fixture categories:

```text
snapshot fixtures
  no projects
  multiple projects
  project with zero worktrees
  worktree with no agent
  idle agent
  working agent
  needs-attention agent
  stuck agent
  exited agent
  orphaned terminal target
  unknown low-confidence harness run

command fixtures
  session.create
  session.startAgent
  terminal.focus
  worktree.remove
  hook.ingest or hook ingestion API payloads
  system.reconcile

error fixtures
  ConfigError
  ProtocolError
  ProviderUnavailableError
  ExternalCommandError
  WorktreeProviderError
  TerminalProviderError
  HarnessProviderError
  ReconcileError
  PersistenceError
  TimeoutError
  CancellationError
```

### 19.8 Contract tests

Contract tests protect public boundaries.

They must cover:

```text
ObserverApi request and response envelopes.
WosmSnapshot shape.
WosmCommand shape.
WosmEvent shape.
SafeError shape.
Provider capability shape.
Provider observation shape.
Config schema shape.
Debug bundle shape.
```

Every concrete provider must pass the shared provider contract tests.

Examples:

```text
WorktreeProvider
  listWorktrees returns normalized observations.
  createWorktree maps provider failures to typed errors.
  removeWorktree does not leak raw external output in SafeError.

TerminalProvider
  listTargets returns normalized terminal observations.
  focusTarget handles stale targets with a typed TerminalProviderError.
  provider-specific identifiers remain in providerData or diagnostics only.

HarnessProvider
  buildLaunch returns a launch plan without spawning by itself.
  discoverRuns returns normalized observations.
  classifyRun returns normalized status and confidence.
  raw event ingestion produces normalized harness observations.
```

The observer and TUI must not know provider-specific payload shapes.

### 19.9 Unit tests

Unit tests should cover:

```text
Config parsing and project defaults.
Duplicate project ID detection.
Path expansion.
Schema validation.
Snapshot selectors.
Project/worktree grouping.
Command validation.
Status priority logic.
Status confidence policy.
Reconciliation graph diffing.
SafeError redaction.
ErrorEnvelope creation.
Debug bundle redaction.
Provider output parsers.
Terminal target parsers.
Harness event parsers.
Worktrunk output parsers.
```

Pure logic should stay pure and easy to test. Effect should not be forced into pure functions just to make the code look consistent.

### 19.10 Effect boundary tests

Effect is used selectively at runtime boundaries. Those boundaries must be tested.

Required cases:

```text
Provider call timeout maps to TimeoutError.
External command failure maps to ExternalCommandError.
Cancelled command maps to CancellationError.
Retried provider call records retry attempts.
Command queue serializes commands per worktree/session.
Shutdown interrupts in-flight work and persists cancellation/failure records.
Span and trace IDs propagate from command receipt to provider calls and logs.
Resource cleanup runs after failed provider calls.
```

The goal is not to test Effect itself. The goal is to test wosm's boundary behavior.

### 19.11 Integration tests

Integration tests validate one boundary or subsystem at a time.

Recommended integration suites:

```text
observer + fake providers
  multi-project reconcile
  no-agent worktree rows
  idle/working/attention/stuck/exited state handling
  orphaned terminal target handling
  command lifecycle

protocol + observer
  socket startup
  request/response
  event subscription
  reconnect after stale socket
  command receipt and command events

config + observer
  config changes
  invalid config errors
  zero-worktree projects

worktrunk provider
  fake wt binary
  fixture parsing
  create/list/remove command construction

terminal provider
  fake tmux binary
  optional real tmux smoke test
  stale target handling
  identity binding normalization

harness provider
  fake raw events
  fake process/run discovery
  scripted fake agent launch
  status classification
```

### 19.12 TUI tests

The TUI is a client of the observer. TUI tests must use observer snapshots/events, not providers.

Required TUI tests:

```text
Project-first rendering.
Multiple configured projects.
Project with zero worktrees.
Worktree with no agent.
Idle agent row.
Working agent row.
Needs-attention row.
Stuck row.
Exited row.
Unknown low-confidence row.
Search.
Grouping/collapse.
Slot mapping.
Prompt flows.
Command dispatch.
SafeError toast.
Diagnostic ID visibility.
Event-driven row updates.
```

Forbidden in TUI tests:

```text
Calling wt.
Calling tmux.
Calling Codex or OpenCode.
Parsing provider-specific payloads.
Deriving runtime truth from raw terminal output.
```

### 19.13 E2E tests

E2E tests validate complete product flows.

Baseline E2E should run with fake providers:

```text
start observer
load config
connect protocol client
get snapshot
start TUI or TUI test harness
create session through command dispatch
observe command events
observe graph update
focus terminal target
stop or close session
produce debug bundle
```

Optional E2E can use real tmux, real Worktrunk, or real harnesses depending on environment.

E2E tests must create isolated temp projects and must not touch the user's actual repositories.

### 19.14 True agent-driven tests

True agent-driven tests are required, but they must be split into deterministic and real-agent lanes.

#### Scripted-agent tests

Scripted-agent tests run in normal CI.

A scripted agent is a deterministic fake agent process that behaves like a harness run:

```text
starts
prints known output
modifies files in a temp worktree
emits optional fake events
waits or exits on command
```

Scripted-agent tests prove that wosm can launch, observe, classify, reconcile, and diagnose agent-like processes without relying on model behavior.

Example scenario:

```text
Scenario: scripted agent completes a file task

Given:
  a temp project configured in config.toml
  a fake WorktreeProvider or temp Worktrunk fixture
  a fake or real TerminalProvider test harness
  a ScriptedAgentHarnessProvider

When:
  the TUI or protocol client dispatches session.create
  the scripted agent edits task.txt and exits

Then:
  observer records command.started and command.succeeded
  worktree row transitions through starting -> working -> exited or idle
  expected file changes exist
  SQLite events contain the lifecycle
  debug bundle includes command, event, provider health, and trace context
```

#### Real-agent tests

Real-agent tests are opt-in.

They may run against Codex, OpenCode, or another supported harness. They must use sandbox repositories and bounded prompts. They must never run against the user's private active repositories by default.

Real-agent test requirements:

```text
Requires explicit environment flag.
Requires isolated temp project.
Requires bounded prompt.
Requires timeout.
Requires cleanup.
Requires redacted diagnostic bundle on failure.
Must not block standard CI.
```

### 19.15 Agent-diagnosis tests

Agent-diagnosis tests validate that wosm is diagnosable by coding agents.

A diagnostic test injects a known failure, creates a debug bundle, and verifies that the bundle contains enough information to identify the root cause.

A stronger optional variant gives the bundle to a real or scripted diagnostic agent and asks it to classify the issue.

Example injected failures:

```text
stale terminal target
missing Worktrunk binary
invalid project root
provider command timeout
hook event arrives while observer is offline
SQLite write failure
config parse error
harness process exits unexpectedly
```

Required bundle evidence:

```text
commandId
traceId or spanId
provider name
safe user-facing error
internal error tag
recent related events
recent related logs
provider health
last reconcile result
redaction status
```

### 19.16 Diagnostic and observability tests

Observability must be tested, not assumed.

Required cases:

```text
Structured logs are valid JSONL.
Logs include traceId/spanId when available.
Logs redact secrets and private env values.
SQLite events record command lifecycle.
Provider health appears in snapshot and debug bundle.
Reconcile timing appears in debug bundle.
SafeError does not contain raw stack traces by default.
Debug bundle includes enough context to diagnose known failures.
Debug bundle redaction tests cover paths, tokens, env vars, and command output.
```

### 19.17 Testkit requirements

The repo must include a testkit that makes good tests easy to write.

Required helpers:

```text
FakeWorktreeProvider
FakeTerminalProvider
FakeHarnessProvider
ScriptedAgentHarnessProvider
FakeExternalCommandRunner
TempProjectFactory
TempConfigFactory
TempSqliteFactory
ObserverTestHarness
ProtocolTestClient
TuiRenderHarness
DebugBundleAssertions
RedactionAssertions
```

The testkit should be reusable by future agents. It should reduce the temptation to write fragile, one-off integration tests.

### 19.18 Testing rules

Hard rules:

```text
No random floating test files.
No provider-specific payload assumptions in observer or TUI tests.
No real user repositories in automated tests.
No real agent tests in standard CI.
No unredacted secrets in fixtures, logs, snapshots, or debug bundles.
No test that depends on terminal titles for identity.
No test that requires external network unless explicitly marked real-agent/manual.
```

Recommended rule:

```text
Every bug that reaches manual testing should become either:
  a unit test,
  an integration test,
  an E2E test,
  a diagnostic test,
  or an agent-driven test.
```

## 20. Companion phased-development plan

The detailed development sequence lives in the companion document:

```text
wosm Phased Development Cycle - V1
```

That document defines:

```text
phase goals
non-goals
build scope
test packs
red-first expectations
acceptance criteria
exit artifacts
risks
```

The TDD owns architecture and testing structure. The companion plan owns implementation order.

---

## 21. Key design decisions

### Decision 1: TypeScript observer for v1

Use TypeScript to maximize shared contracts and speed of rebuild. Leave Rust as a future option behind the same protocol.

### Decision 2: Node.js LTS runtime

Use Node LTS for the observer, CLI, TUI, integrations, hook receiver, and tests. Bun is experiment-only until compatibility is proven.

### Decision 3: Observer is a lazy local daemon

The observer is daemon-like because it keeps a live graph, command log, hook ingestion, and event stream. It is lazy because it starts on demand and can exit when idle.

### Decision 4: Provider-neutral core

tmux, Codex, OpenCode, and Worktrunk are supported integrations, not core concepts. Core code depends on provider contracts and normalized observations.

### Decision 5: Protocol package replaces bridge scripts

The TUI/CLI communicate with observer through `@wosm/protocol` over a local socket. Do not recreate shell bridge scripts.

### Decision 6: SQLite replaces `.ws-*` source-of-truth files

Use observer-owned SQLite for durable command/event/session/correlation state. Do not use `.ws`, `.ws-meta`, or `.ws-*` files as runtime authority.

### Decision 7: Tmux as reference terminal provider

Build the first terminal provider around tmux IDs, identity binding, pane capture, and popup support. Keep tmux-specific mechanics inside `integrations/terminal/tmux`.

### Decision 8: Worktrunk owns worktrees

Do not duplicate git worktree lifecycle logic except emergency fallback behavior. Wrap `wt` through a TypeScript `WorktrunkProvider`.

### Decision 9: Config defines projects

The dashboard is project-first. It shows configured projects and their worktrees, whether or not an agent is running.

### Decision 10: Worktree rows, not session rows

The primary TUI row is a worktree. Agent/session/terminal state is attached to the worktree when present.

### Decision 11: Status has confidence

Every status should include confidence and reason. Unknown is acceptable.

### Decision 12: TUI is a client

TUI owns presentation state and observer-client IO orchestration only. Observer is the source for runtime state and command routing.

### Decision 13: Stable generated IDs

Do not depend on names, titles, paths, slots, terminal titles, or provider-specific IDs for core identity.

### Decision 14: Integrations are not packages

Harnesses, terminals, and worktree providers are integration directories. Shared contracts/protocol/config are packages.

### Decision 15: Shell is not runtime logic

Shell wrappers and hooks may call wosm, but durable state machines and orchestration live in TypeScript.

### Decision 16: Effect is selective runtime infrastructure

Use Effect in observer, CLI control flow, hook receiver, provider boundary wrappers, command queue, reconcile loop, external command execution, retries, timeouts, cancellation, resource cleanup, and typed errors. The TUI may also use Effect at observer-protocol IO and command orchestration boundaries. Do not require Effect in React presentation components, pure selectors, or pure data contracts.

### Decision 17: Observability is first-class

Structured logs, SQLite events, trace/span context, provider health, reconcile timing, and debug bundles are part of the core system, not cleanup work after MVP.

### Decision 18: Debug bundles are required for agent debugging

`wosm debug bundle` must produce redacted, agent-readable diagnostics that explain recent commands, events, provider health, errors, logs, config summary, socket/pid state, hook spool state, and reconcile timing.

### Decision 19: Testing structure is architectural

The repository test layout, test tiers, fake providers, scripted agents, diagnostic tests, and CI lanes are defined in the TDD. They are not incidental project hygiene. They are how the observer, protocol, providers, and TUI remain separable.

### Decision 20: Detailed sequencing belongs in the companion phased plan

The TDD should not become a build checklist. The detailed implementation sequence lives in the companion phased development plan. The TDD defines what the system is and how its pieces relate; the companion plan defines how to build it.

### Decision 21: One primary agent pane per worktree in MVP

A worktree may have supporting terminal panes, but wosm v1 manages one primary agent pane and one primary agent run per worktree. The TUI should not expose multiple concurrent main agents inside the same worktree.

### Decision 22: tmux uses a workbench topology for the reference provider

The tmux provider MVP uses one global `wosm` workbench session with one window per worktree and one primary agent pane inside each worktree window. This is a provider implementation choice, not a core architecture primitive.

### Decision 23: Worktrunk hooks are first-class MVP inputs

Worktrunk lifecycle hooks should be installed, validated, and used to notify observer about external worktree lifecycle changes. Hooks auto-start the lazy local observer when needed, trigger immediate reconciliation, and spool only as a fallback when startup or delivery fails. They are notification hints, not authoritative state.

### Decision 24: Codex status is confidence-based and conservative

Codex is the first harness provider, but the core status model is provider-neutral. Codex v1 should report state with confidence and reason, prefer `unknown` over false certainty, and promote richer `idle`/`working` states only when tests prove the signals.

### Decision 25: Project-local config is MVP, explicit opt-in only

Global config remains authoritative for which projects wosm manages. Project-local config may supplement safe defaults only when explicitly enabled in the global project entry. It must not silently add projects, install hooks, override destructive-command policy, or change security-sensitive provider settings.

### Decision 26: Runtime doctor is required before polish

`wosm doctor` must validate config, observer, SQLite, provider availability, hook installation state, hook spool, runtime graph health, recent errors, and debug bundle availability before dog/notification work begins. Deep simulation doctor is deferred to a later phase.

### Decision 27: v1 TUI focuses agents; prompt sending is deferred

The v1 TUI should focus the terminal target for an idle agent rather than sending prompts automatically. The `session.sendPrompt` contract is reserved, but it should not be exposed until a harness provider proves safe prompt delivery. A later paste-and-focus feature may be considered.

### Decision 28: Worktrunk hook setup is plan/apply/uninstall, not docs-only

Because Worktrunk hooks are first-class MVP inputs, wosm must provide explicit hook config plan, install, uninstall, and doctor flows. The installer must be idempotent, non-destructive, backed up, diff-previewable, and limited to tiny hook receiver commands.

### Decision 29: Hook receivers auto-start observer by default

When a Worktrunk or harness hook fires and the observer is offline, the hook receiver should attempt to auto-start the observer and deliver the event. If startup or delivery fails, the event is written to the spool and later drained. Hook auto-start is default MVP behavior because hooks are first-class runtime inputs, but the path must be bounded, nonblocking, rate-limited, and diagnosable.

### Decision 30: Unknown rows are visible but not alerts by default

`unknown` rows remain inside their project group. They are sorted after known active states and before inactive/no-agent rows. They are not global alerts unless the observer attaches a concrete warning reason.

### Decision 31: Recovery breadcrumbs are external by default

Breadcrumbs live under local state by default. In-worktree breadcrumbs are allowed only by explicit per-project opt-in, and provider-native metadata is preferred when available. Breadcrumbs are recovery hints, never authoritative state.

### Decision 32: No TUI inspect/debug panel in v1

The v1 TUI does not implement row-level inspect or provider-debug panels. Deeper debugging is handled through CLI and diagnostics: `wosm doctor`, `wosm debug bundle`, `wosm snapshot --json`, command records, events, and logs. Raw provider details remain out of normal TUI behavior until a later UX phase.

### Decision 33: Effect is standardized through a small runtime subset

V1 standardizes a small `@wosm/runtime` subset: `Effect`, `Cause`/`Exit`, `Context`/`Layer`, `Scope`, `Schedule`, `Queue`, `Logger`/annotations, `Duration`, and wosm wrappers for external commands, retry, timeout, cancellation, resource cleanup, and typed error conversion. Stream, STM, full metrics, mandatory OpenTelemetry export, Effect Config, and Effect Schema are deferred or implementation details unless a concrete need appears.

### Decision 34: The TUI may use Effect at IO and orchestration boundaries

The TUI is not fully sheltered from Effect. It may use Effect in observer connection lifecycle, event subscription, command dispatch, retry/cancel/cleanup, and SafeError conversion. React/Ink presentation components and pure selectors should remain plain TypeScript. The TUI must still not call providers, parse raw provider payloads, or derive runtime truth.

### Decision 35: Protocol exposes simple async APIs and may also expose Effect-native APIs

The protocol package may expose a Promise/AsyncIterable facade for simple consumers and an Effect-native client for code paths that benefit from structured orchestration. This allows the TUI service layer, CLI, observer tests, and diagnostic tools to choose the right boundary without forcing Effect into every component.

### Decision 36: Debug bundle ships before real providers

An operational `wosm debug bundle` must exist before the first real provider integration is considered shippable. It must work with fake providers and injected failures, include redacted config summaries, health, snapshots, commands, events, errors, logs, spool status, trace/span context, and a redaction report, and be readable by humans and AI agents.

### Decision 37: OpenTelemetry is designed for but disabled by default

V1 uses trace/span IDs and stable operation names that can map to OpenTelemetry later. Actual OpenTelemetry export is disabled or no-op by default until local observability is stable. Local JSONL logs, SQLite events, runtime doctor, and debug bundles remain the baseline.

### Decision 38: Diagnostic retention is bounded by default

Default diagnostic retention is local and bounded: approximately 14 days and 250 MB total for logs and diagnostic files, component-level rotation, SQLite event/command/error retention windows, limited debug bundle retention, and hook spool cleanup. `wosm doctor` must report local state usage and retention health.

## 22. Risks and mitigations

The risks are intentionally written as readable entries instead of a wide table so the DOCX and PDF remain usable.

### 22.1 Codex status signals are incomplete

Impact: UI may show unknown/working incorrectly

Mitigation: Use capabilities, confidence model, process/terminal fallback, and provider-local classifiers.

### 22.2 Core becomes tmux-shaped

Impact: Hard to add other terminal providers

Mitigation: Keep tmux details in integrations/terminal/tmux; observer consumes normalized TerminalTargetObservation.

### 22.3 Core becomes Codex-shaped

Impact: Hard to add OpenCode/future harnesses

Mitigation: Keep Codex details in integrations/harness/codex; observer consumes normalized HarnessRunObservation.

### 22.4 Observer scope creep

Impact: Product becomes another big backend

Mitigation: Enforce provider contracts, Worktrunk ownership, and command router boundaries.

### 22.5 SQLite schema gets overbuilt too early

Impact: Slows implementation

Mitigation: Start with boring command/event/session/correlation tables; migrate intentionally.

### 22.6 Hook events or spool become hidden truth

Impact: Stale events confuse state

Mitigation: Treat hooks as notifications and spool as delivery queue; reconcile from providers before graph updates.

### 22.7 Tmux workbench layout becomes too opinionated

Impact: Hard to adapt per project

Mitigation: Keep workbench topology in tmux provider only; make window layout configurable and manage one primary agent pane by default.

### 22.8 Worktrunk output shape changes

Impact: Provider breaks

Mitigation: Prefer structured output, add provider contract tests and fixtures, isolate parsing.

### 22.9 Hook installation mutates user config badly

Impact: Loss of trust

Mitigation: Use plan/apply/uninstall, explicit confirmation, backups, non-destructive edits, and doctor verification.

### 22.10 Shell logic grows again

Impact: Recreates wosm1 fragility

Mitigation: Keep shell wrappers tiny and test core in TypeScript.

### 22.11 Performance degrades with many sessions

Impact: Popup becomes annoying

Mitigation: Use observer cache, event stream, adaptive reconciliation, and async enrichment.

### 22.12 TUI accidentally becomes backend

Impact: Architecture regresses

Mitigation: TUI imports no integrations. Core commands go through observer. Effect/runtime usage in TUI stays at protocol IO and orchestration boundaries.

### 22.13 Prompt sending targets the wrong agent

Impact: User loses trust or modifies the wrong worktree

Mitigation: v1 focuses terminal only; reserve prompt-send until harness-native safe delivery is proven.

### 22.14 Project config drifts from reality

Impact: User sees confusing state

Mitigation: Show provider health, orphan summaries, and CLI diagnostics; reconcile from real systems.

### 22.15 Project-local config becomes hidden authority

Impact: Repos unexpectedly change runtime behavior

Mitigation: Use global opt-in, restricted MVP fields, trust checks, and doctor reporting.

### 22.16 Bun temptation creates runtime split

Impact: Hard-to-debug compatibility issues

Mitigation: Node LTS only for v1; Bun experiments must pass the full suite before reconsideration.

### 22.17 Monorepo tooling gets too complex

Impact: Tooling becomes architecture

Mitigation: Use pnpm/Turbo/Biome/Vitest/Lefthook; defer Nx/Changesets unless needed.

### 22.18 Effect overuse makes code hard to read

Impact: Contributors and agents struggle with simple code

Mitigation: Use Effect only at runtime, IO, and orchestration boundaries; keep React components, pure selectors, and contracts plain TypeScript.

### 22.19 Effect underuse leaves async errors ad hoc

Impact: Retries, timeouts, cancellation, and error mapping sprawl

Mitigation: Use Effect in observer/provider boundaries and command execution.

### 22.20 Logs become noisy or unhelpful

Impact: Debugging gets harder despite more output

Mitigation: Use shared observability wrappers and stable structured log schemas.

### 22.21 Logs leak secrets

Impact: Loss of trust and unsafe diagnostic bundles

Mitigation: Redaction by default; test debug bundle redaction; no raw secrets in logs.

### 22.22 Diagnostic data becomes source of truth

Impact: Stale logs confuse runtime state

Mitigation: Treat logs as diagnostics only; reconcile from config/providers/SQLite state.


### 22.23 Hook auto-start surprises users

Impact: Provider hooks may start observer when the user did not explicitly open wosm.

Mitigation: Keep hook auto-start bounded, nonblocking, rate-limited, logged, and visible in doctor/debug output. If startup fails, spool instead of blocking the provider command.

### 22.24 Unknown rows become noisy

Impact: Conservative status classification may make the TUI feel uncertain.

Mitigation: Keep unknown rows visible but subdued inside project groups. Do not alert on unknown unless the observer has a concrete warning reason.

### 22.25 In-worktree breadcrumbs dirty repositories

Impact: Users may lose trust if wosm writes unexpected files into codebases.

Mitigation: Default to external breadcrumbs. Require per-project opt-in for in-worktree breadcrumbs and have doctor report ignore/tracking status.

### 22.26 Lack of TUI inspect panel slows early debugging

Impact: Users may need CLI diagnostics for row-level provider details.

Mitigation: Make `wosm doctor`, `wosm debug bundle`, `wosm snapshot --json`, and command/event logs strong before relying on the TUI for deeper debugging.

### 22.27 TUI Effect usage becomes UI complexity

Impact: React components become harder to read and test.

Mitigation: Keep Effect in TUI service hooks and protocol orchestration. Components receive plain props/state and never call providers or parse raw provider data.

### 22.28 OpenTelemetry work distracts from local diagnostics

Impact: Exporter complexity arrives before local logs, events, doctor, and debug bundles are reliable.

Mitigation: Design trace/span compatibility in V1 but keep OpenTelemetry export disabled or no-op by default.

### 22.29 Diagnostic retention grows local state too much

Impact: Users lose trust if `~/.local/state/wosm` grows without bound.

Mitigation: Enforce age and size retention defaults, component rotation, doctor-visible local state usage, and configurable limits.

## 23. Resolved open questions and V1 baseline

All open questions tracked during the drafting process are resolved for the V1 baseline:

```text
1. Terminal targets: one main agent pane per worktree in MVP.
2. tmux topology: one global wosm workbench session with windows per worktree.
3. Worktrunk hooks: first-class MVP inputs that notify observer and trigger reconcile.
4. Codex status: conservative confidence-based classification.
5. Project-local config: minimal explicit opt-in support in MVP; global config remains authoritative for project membership.
6. Doctor: runtime doctor is required before dog/notification/polish work.
7. Prompt sending: v1 focuses terminals only; sendPrompt is reserved for later safe support.
8. Worktrunk hook templates: wosm provides plan/apply/uninstall setup flows; documentation alone is not enough.
9. Hook receivers: auto-start observer by default; spool on startup/delivery failure.
10. Unknown rows: visible inside project groups, not alerts by default.
11. Recovery breadcrumbs: external by default; in-worktree only by explicit per-project opt-in; provider-native metadata preferred.
12. Inspect/debug panel: no TUI inspect/debug panel in v1; use CLI/doctor/debug-bundle workflows and revisit later.
13. Effect modules: standardize a small @wosm/runtime subset for runtime orchestration; defer heavier modules unless needed.
14. TUI Effect posture: TUI may use Effect at IO/orchestration boundaries; components remain plain and provider-neutral.
15. Debug bundle: operational debug bundle exists before real providers ship.
16. OpenTelemetry: design for compatibility but keep export disabled/no-op by default.
17. Log retention: balanced local retention, about 14 days and 250 MB by default, configurable and visible in doctor.
```

This does not mean the architecture is frozen forever. Future discoveries should be handled as explicit design changes against this baseline, with tests and phased-plan updates.

## 24. External references consulted

These references ground current tool assumptions only. The architecture remains greenfield.

- Node.js previous releases: https://nodejs.org/en/about/previous-releases
- Node.js release schedule announcement: https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule
- pnpm 11.0 release: https://pnpm.io/blog/releases/11.0
- pnpm installation prerequisites: https://pnpm.io/installation
- pnpm workspaces: https://pnpm.io/workspaces
- pnpm Git branch lockfiles: https://pnpm.io/git_branch_lockfiles
- Turborepo documentation: https://turborepo.dev/docs
- Turborepo running tasks: https://turborepo.dev/docs/crafting-your-repository/running-tasks
- Biome documentation: https://biomejs.dev/
- Vitest documentation: https://vitest.dev/guide/
- Lefthook documentation: https://lefthook.dev/
- Changesets repository: https://github.com/changesets/changesets
- Worktrunk GitHub README: https://github.com/max-sixty/worktrunk
- Worktrunk docs: https://worktrunk.dev/
- Worktrunk extending/hooks docs: https://worktrunk.dev/extending/
- OpenAI Codex CLI features: https://developers.openai.com/codex/cli/features
- OpenAI Codex CLI reference: https://developers.openai.com/codex/cli/reference
- OpenAI Codex hooks: https://developers.openai.com/codex/hooks
- OpenAI Codex configuration reference: https://developers.openai.com/codex/config-reference
- OpenCode docs: https://opencode.ai/docs/
- OpenCode home: https://opencode.ai/
- Bun documentation/home: https://bun.com/
- SQLite documentation: https://www.sqlite.org/docs.html
- SQLite atomic commit documentation: https://www.sqlite.org/atomiccommit.html
- Effect home and documentation: https://effect.website/
- Effect introduction: https://effect.website/docs/getting-started/introduction/
- Effect expected errors: https://effect.website/docs/error-management/expected-errors/
- Effect retrying: https://effect.website/docs/error-management/retrying/
- Effect queues: https://effect.website/docs/concurrency/queue/
- Effect fibers/concurrency: https://effect.website/docs/concurrency/fibers/
- Effect logging: https://effect.website/docs/observability/logging/
- Effect tracing: https://effect.website/docs/observability/tracing/
- Effect metrics: https://effect.website/docs/observability/metrics/
- OpenTelemetry JavaScript docs/status: https://opentelemetry.io/docs/languages/js/
- OpenTelemetry logs concepts: https://opentelemetry.io/docs/concepts/signals/logs/
