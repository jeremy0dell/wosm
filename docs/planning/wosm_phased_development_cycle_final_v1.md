# wosm Phased Development Cycle - Final V1

Companion to `wosm Rebuild Technical Design Document - Final V1`.

This document defines the build sequence for the wosm rebuild. The TDD defines architecture, contracts, state ownership, provider boundaries, and testing structure. This companion defines how to implement the system phase by phase without turning the rebuild into a partially wired pile of infrastructure.

The rebuild is greenfield. There is no dependency on old wosm source code.


---

## 0. What changed in V1

V1 consolidates the phased plan around the final TDD baseline.

Key changes from the last draft:

- Effect is treated as selective runtime infrastructure through a small `@wosm/runtime` subset, not a whole-codebase mandate.
- The TUI may use Effect in observer-client IO, event subscription, command dispatch, cancellation, retry, and cleanup boundaries while keeping React components plain and provider-neutral.
- The minimum operational debug bundle moves earlier: it must exist before the first real provider integration ships and must work with fake providers and injected failures.
- OpenTelemetry export remains out of scope for V1, but trace/span IDs and stable operation names are established.
- Diagnostic retention is added to the development plan, including default size/age limits and doctor-visible local state usage.
- The plan remains a build sequence, not a file-by-file implementation spec.

## 1. Purpose

Wosm is large enough that implementation order matters.

The system includes:

```text
observer daemon
TUI
CLI
protocol
config
SQLite state
provider contracts
Worktrunk provider
terminal provider
a harness subsystem
Effect runtime boundary code
structured observability
debug bundles
unit/integration/e2e/agent tests
```

A normal implementation plan like "build backend, then frontend" is too vague. Each phase must create a coherent product slice, with tests written first, and with clear exit criteria.

The goal of this document is to let humans and coding agents pick up one phase at a time and know:

```text
what to build
what not to build
what tests to write first
what should be red before implementation
what makes the phase green
what artifacts must exist before moving on
```

---

## 2. Development principles

### 2.1 Build vertical slices

Each phase should build a meaningful slice that proves part of the architecture.

Bad phase shape:

```text
write a lot of types
write a lot of helper files
wire nothing together
```

Good phase shape:

```text
define a contract
write tests for it
build fake providers
make observer produce a snapshot
make protocol client request it
prove it with fixtures
```

### 2.2 Tests first, main green

Each phase uses red-first development:

```text
write tests
confirm expected failure
implement
make tests pass
merge only green
```

Tests should run red locally at the beginning of a slice. The main branch should not stay red.

### 2.3 Keep provider-specific behavior behind providers

Each phase must preserve the provider-neutral architecture.

```text
Core concepts:
  project
  worktree
  terminal target
  harness run
  session
  observation
  command
  event

Provider examples:
  Worktrunk
  tmux
  Codex
  OpenCode
```

The TUI must not import providers. The observer core must not parse raw provider payloads directly. Provider quirks stay in `integrations/...`.

### 2.4 Use fakes before real tools

The implementation should prove architecture with fakes before depending on external tools.

```text
fake providers first
fake external command runners first
scripted agent first
real Worktrunk/tmux/Codex later
```

This avoids flakiness and lets standard CI run without local terminal state, model subscriptions, or user repositories.

### 2.5 Observability from the beginning

Observability is not a final hardening task.

Every command path and provider boundary should eventually produce:

```text
structured log entries
SQLite events
trace/span IDs when available
typed errors
SafeError for UI/CLI
provider health
reconcile timing
debug-bundle evidence
```

The early phases can implement minimal versions, but the shape must exist from the start.

---

## 3. Phase format

Every phase should be tracked with this template.

```text
Goal
  The outcome this phase proves.

Non-goals
  Things that are intentionally deferred.

Build scope
  Components, packages, or integrations to implement.

Test pack
  Tests to write before implementation.

Red-first expectations
  What should fail before implementation and why.

Acceptance criteria
  What must be true when the phase is complete.

Exit artifacts
  Files, commands, fixtures, docs, or debug outputs that must exist.

Risks
  What can go wrong and how to contain it.
```

---

## 4. Phase 0 - Repository, tooling, and test skeleton

### Goal

Create the TypeScript monorepo, tooling, test layout, and fake-test infrastructure before product logic grows.

This phase does not build wosm behavior. It builds the workspace where wosm behavior can be built safely.

### Non-goals

```text
No real observer behavior.
No real TUI behavior.
No Worktrunk integration.
No tmux integration.
No Codex/OpenCode integration.
No real agent execution.
```

### Build scope

```text
pnpm workspace
Turborepo task graph
TypeScript base config
Biome config
Vitest config
Lefthook config
workspace package skeletons
test directory skeletons
basic fixture conventions
initial testkit skeleton
```

Expected repository shape:

```text
apps/
  observer/
  cli/
  tui/

packages/
  contracts/
  protocol/
  config/
  observability/
  runtime/
  testing/

integrations/
  worktree/worktrunk/
  terminal/tmux/
  harness/codex/
  harness/opencode/

tests/
  support/
  e2e/
  agent/
  diagnostics/
  contract-fixtures/
```

### Test pack

Write tests that fail because the real implementation does not exist yet:

```text
contracts schema test placeholder
protocol client/server smoke placeholder
observer health placeholder
config load placeholder
fake provider testkit placeholder
debug bundle placeholder
scripted-agent lifecycle placeholder
```

### Red-first expectations

The first run should fail for expected missing exports or missing implementations.

```text
pnpm test:unit        fails because contracts are empty
pnpm test:contracts   fails because schemas are empty
pnpm test:integration fails because observer/testkit do not exist
```

Then implement enough scaffolding so all placeholder tests pass without pretending product behavior exists.

### Acceptance criteria

```text
pnpm install works
pnpm build works or has documented empty-workspace behavior
pnpm typecheck works
pnpm lint works
pnpm test:unit works
pnpm test:contracts works
pnpm test:integration works with placeholder suites
pnpm test:agent:scripted exists and runs a placeholder suite
no random floating tests exist
```

### Exit artifacts

```text
package.json
pnpm-workspace.yaml
turbo.json
biome.json
lefthook.yml
tsconfig.base.json
workspace package skeletons
test folder skeletons
README note for test layout
```

### Risks

Risk: Too much time spent perfecting tooling.

Mitigation: Keep tooling boring. pnpm, Turbo, Biome, Vitest, Lefthook. Do not introduce Nx, custom runners, or shell-heavy orchestration.

---

## 5. Phase 1 - Contracts, schemas, and fixtures

### Goal

Define the language of the system.

By the end of this phase, commands, events, snapshots, provider observations, config objects, and safe errors should have validated schemas and fixtures.

### Non-goals

```text
No observer reconcile loop yet.
No provider implementation yet.
No TUI rendering yet.
No real socket protocol yet.
```

### Build scope

```text
packages/contracts
packages/config schema types
provider capability types
provider observation types
command/event types
SafeError and ErrorEnvelope types
snapshot and WorktreeRow types
fixture validation helpers
```

Required core types:

```text
ProjectView
WorktreeView
SessionView
WorktreeRow
WosmSnapshot
WosmCommand
WosmEvent
SafeError
ErrorEnvelope
ProviderHealth
WorktreeObservation
TerminalTargetObservation
HarnessRunObservation
HarnessStatusObservation
```

### Test pack

Write schema and fixture tests first.

```text
valid snapshot fixtures parse
invalid snapshot fixtures fail
valid command fixtures parse
invalid command fixtures fail
valid event fixtures parse
invalid event fixtures fail
SafeError fixtures parse and reject raw stacks
provider observation fixtures parse
config fixtures parse
```

Create fixtures for:

```text
no configured projects
multiple configured projects
project with zero worktrees
worktree with no agent
idle agent
working agent
needs-attention agent
stuck agent
exited agent
unknown low-confidence agent
orphaned terminal target
provider failure
```

### Red-first expectations

Tests should fail because schemas and fixtures are not implemented.

Expected failures:

```text
missing type exports
missing schema validators
fixtures fail validation
SafeError redaction helpers missing
```

### Acceptance criteria

```text
All contract tests pass.
All fixtures validate or fail intentionally.
Contracts are provider-neutral.
No tmux-specific or Codex-specific field is required by the core snapshot.
```

### Exit artifacts

```text
packages/contracts/src/*.ts
packages/contracts/test/schema/*.test.ts
packages/contracts/test/fixtures/*
tests/contract-fixtures/*
```

### Risks

Risk: Over-modeling too early.

Mitigation: Keep contracts sufficient for Phase 2 fakes. Add fields only when an actual phase needs them.

---

## 6. Phase 2 - Config and project model

### Goal

Make multi-project configuration real.

The system should be able to parse `~/.config/wosm/config.toml`, validate multiple projects, apply defaults, reject invalid config, and produce project records for the observer, and support minimal explicit opt-in project-local config.

### Non-goals

```text
No real Worktrunk calls.
No terminal discovery.
No harness discovery.
No TUI beyond optional fixture rendering.
```

### Build scope

```text
packages/config
TOML loading
path expansion
schema validation
project defaults
minimal project-local config opt-in
project-local trust/merge rules
duplicate project detection
config error typing
config fixture tests
```

### Test pack

```text
multiple projects parse correctly
global defaults apply
project defaults override global defaults
duplicate project IDs are rejected
duplicate aliases are rejected
invalid root produces ConfigError
missing required fields produce ConfigError
project with zero worktrees still appears in derived project list
project-local config is ignored unless explicitly enabled globally
project-local config can add safe commands/layout defaults
project-local config cannot add projects or override sensitive policy
invalid project-local config degrades project health instead of crashing dashboard
```

### Red-first expectations

Tests fail because loader and validators do not exist.

### Acceptance criteria

```text
Config loader returns normalized project config.
Project-local config is merged only when explicitly enabled.
Config errors are typed and convertible to SafeError.
No project names are hardcoded.
At least four sample projects can be represented in fixtures.
```

### Exit artifacts

```text
packages/config/src/loadConfig.ts
packages/config/src/schema.ts
packages/config/test/unit/*
examples/config.toml
examples/project-local-config.toml
```

### Risks

Risk: Config starts to describe live runtime state.

Mitigation: Config defines projects and defaults only. Worktrunk owns actual worktrees. Observer owns correlations.

---

## 7. Phase 3 - Observer core with fake providers

### Goal

Prove that the observer can correlate configured projects, worktrees, terminal targets, and harness runs into a normalized graph without real external tools.

This is the most important architecture phase.

### Non-goals

```text
No real Worktrunk.
No real tmux.
No real Codex/OpenCode.
No user-facing TUI.
No Unix socket protocol yet unless needed for tests.
```

### Build scope

```text
apps/observer core
provider registry
fake worktree provider
fake terminal provider
fake harness provider
reconcile function
in-memory graph
minimal SQLite setup
basic observer health
Effect runtime boundary skeleton
```

### Test pack

```text
observer reconciles multiple projects
project with zero worktrees appears
worktree with no agent appears
idle agent row appears
working agent row appears
needs-attention row appears
stuck row appears
exited row appears
unknown low-confidence row appears
unknown row remains visible inside its project group without becoming a global alert
orphaned terminal target is reported
provider health appears in snapshot
reconcile timing is recorded
```

### Red-first expectations

Tests fail because observer, graph, and fake providers do not exist.

### Acceptance criteria

```text
Observer can produce WosmSnapshot from fake providers.
All required visible row states exist.
Provider-specific data stays behind provider observations.
Observer graph can be tested without external tools.
```

### Exit artifacts

```text
apps/observer/src/graph.ts
apps/observer/src/reconcile.ts
apps/observer/src/providerRegistry.ts
packages/testing fake providers
tests/support/fake-* providers
observer integration tests
```

### Risks

Risk: Observer becomes provider-specific too early.

Mitigation: Only fake providers are used in this phase. Concrete providers come later.

---

## 8. Phase 4 - Persistence, commands, and event history

### Goal

Add durable observer state and command/event history.

The observer should record command lifecycle, events, provider observations, and basic session correlations in SQLite.

### Non-goals

```text
No TUI command UI yet.
No real providers.
No hook ingestion yet.
```

### Build scope

```text
SQLite schema
migrations
command records
event records
provider observations
session/worktree correlation records
external recovery breadcrumb records/markers
explicit in-worktree breadcrumb opt-in schema
command queue skeleton
command lifecycle
SafeError conversion
```

### Test pack

```text
SQLite initializes with schema version
commands record accepted -> running -> succeeded
commands record accepted -> running -> failed
events persist with commandId when relevant
provider observations persist and expire
SafeError is stored separately from internal error details
observer restart reloads durable state
external breadcrumbs are written/read as parse-only hints
in-worktree breadcrumbs are not written unless project explicitly opts in
breadcrumbs are never treated as authoritative truth
```

### Red-first expectations

Tests fail because persistence and command queue do not exist.

### Acceptance criteria

```text
Observer state survives restart.
Command lifecycle is queryable.
Event history is queryable.
No component except observer reads or writes the DB.
```

### Exit artifacts

```text
apps/observer/src/persistence.ts
apps/observer/src/commandQueue.ts
SQLite migration files
persistence tests
```

### Risks

Risk: SQLite becomes the only truth.

Mitigation: SQLite is durable observer memory. Reconciliation still reads config, providers, and external state.

---

## 9. Phase 5 - Protocol, CLI startup, and hook ingress

### Goal

Make the observer accessible through the local protocol, make the CLI able to start/connect to it, and establish the hook-ingestion path used later by Worktrunk and harness providers.

### Non-goals

```text
No full TUI.
No real providers.
No hook installation yet.
No provider-specific hook parsing yet.
```

### Build scope

```text
packages/protocol
Unix socket transport
request/response envelopes
event subscription
ObserverApi client
ObserverApi server
CLI observer status/start/stop/restart
health endpoint
snapshot.get
command.dispatch
command.get
reconcile endpoint
ingestHookEvent endpoint
CLI hook receiver
hook receiver observer auto-start path
hook spool directory
spool fallback when observer startup or delivery fails
spool drain on observer startup/reconcile
```

### Test pack

```text
client can connect to observer
client can get health
client can get snapshot
client can subscribe to events
client can dispatch a command and get receipt
command events stream to subscriber
stale socket is detected
observer can be started lazily by CLI
observer can be stopped cleanly
hook receiver sends event when observer is online
hook receiver auto-starts observer when socket is unavailable
hook receiver delivers event after successful auto-start
hook receiver writes spool file only when startup or delivery fails
observer drains hook spool on startup/reconcile
hook event triggers reconcile request
hook auto-start is bounded, rate-limited, and nonblocking
```

### Red-first expectations

Tests fail because socket transport, CLI startup, hook receiver, and spool handling do not exist.

### Acceptance criteria

```text
A test client can start observer, request snapshot, dispatch command, and subscribe to events.
A fake provider hook can reach observer through ingestHookEvent.
Offline hook events attempt observer auto-start, deliver when startup succeeds, and spool only on startup/delivery failure.
The TUI will be able to consume this API without provider access.
```

### Exit artifacts

```text
packages/protocol/src/client.ts
packages/protocol/src/server.ts
packages/protocol/src/transport.ts
apps/cli/src/commands/observer.ts
apps/cli/src/commands/hook.ts
hook spool tests
protocol integration tests
```

### Risks

Risk: Protocol gets too complicated.

Mitigation: Keep it local-only, JSON-RPC-like, and boring. No TCP by default.

Risk: Hook events become a parallel state system.

Mitigation: Hook events only trigger persistence and reconciliation. They do not replace provider listing or reconciliation.

## 10. Phase 6 - Observability, runtime boundary, and diagnostic foundation

### Goal

Make the system diagnosable before integrating real tools, establish the minimum runtime doctor, and build the first operational debug bundle before any real provider ships.

This phase also standardizes the small `@wosm/runtime` Effect subset used by observer, CLI, providers, hook receivers, and TUI IO orchestration.

### Non-goals

```text
No active OpenTelemetry exporter; local trace/span structure only.
No real-agent diagnosis yet.
No dog/notification polish.
No requirement that React components become Effect-heavy.
```

### Build scope

```text
packages/runtime
Effect runtime subset wrappers
structured JSONL logs
trace/span IDs
stable operation names
redaction helpers
provider health records
reconcile timing records
ErrorEnvelope
SafeError conversion
operational debug bundle for fake providers
runtime doctor baseline
retention policy and local state usage reporting
```

### Test pack

```text
logs are valid JSONL
logs include traceId/spanId when available
secret-like values are redacted
SafeError excludes stack traces by default
ErrorEnvelope stores internal details
provider health appears in snapshot
debug bundle includes manifest, config summary, health, latest snapshot, commands, events, errors, logs, provider health, spool summary, trace/span IDs, and redaction report
debug bundle works with fake providers and injected failures
debug bundle redacts secrets
wosm doctor reports observer/config/SQLite/provider/hook/snapshot/log health
wosm doctor reports project-local config issues without crashing
wosm doctor reports local state usage and retention status
runtime wrappers enforce timeout/retry/cancellation behavior in tests
```

### Red-first expectations

Tests fail because observability wrappers, runtime boundary helpers, retention reporting, and debug bundle code do not exist.

### Acceptance criteria

```text
Every command path can be traced with commandId and traceId.
Known failures produce useful SafeErrors and diagnostic records.
Operational debug bundle can be generated from fake-provider runs before real providers exist.
`wosm doctor` gives a useful runtime health report against fake providers.
Retention defaults are visible and testable.
```

### Exit artifacts

```text
packages/runtime/src/*
packages/observability/src/*
apps/cli/src/commands/debugBundle.ts
apps/cli/src/commands/doctor.ts
observability fixtures
injected failure fixtures
retention tests
```

### Risks

Risk: Observability becomes log spam.

Mitigation: Instrument shared boundaries, not random lines of code.

Risk: Effect usage becomes too broad.

Mitigation: Standardize a small runtime subset and keep React components, pure selectors, and contracts plain.

Risk: Debug bundle leaks secrets.

Mitigation: Redaction is part of the phase exit criteria, not a later polish item.

## 11. Phase 7 - Worktrunk provider and lifecycle hooks

### Goal

Integrate Worktrunk through a TypeScript provider and make Worktrunk lifecycle hooks a first-class MVP input without making observer or TUI Worktrunk-specific.

### Non-goals

```text
No terminal launch yet.
No harness launch yet.
No TUI command flow yet.
No hook logic in shell bodies.
```

### Build scope

```text
WorktreeProvider interface finalization
WorktrunkProvider
external command runner
fixture parser
listWorktrees
createWorktree
removeWorktree
typed WorktreeProviderError
provider health
Worktrunk hook plan/apply/uninstall flow
Worktrunk hook installation/validation
Worktrunk hook receiver payload shape
observer auto-start from Worktrunk hook events
spool fallback for Worktrunk events when startup/delivery fails
immediate reconcile trigger after Worktrunk hook events
provider-native metadata support when Worktrunk exposes safe metadata
```

### Test pack

```text
fake wt binary list output parses
invalid wt output maps to WorktreeProviderError
listWorktrees returns normalized observations
createWorktree constructs safe argv arrays
removeWorktree constructs safe argv arrays
provider unavailable maps to ProviderUnavailableError
observer reconciles Worktrunk observations into WorktreeRows
wosm worktrunk hooks plan shows intended config changes
wosm worktrunk hooks install applies only after explicit confirmation
wosm worktrunk hooks uninstall removes generated hooks without disturbing unrelated hooks
wosm hooks install worktrunk produces expected hook commands
wosm doctor reports missing/untrusted/disabled Worktrunk hooks as degraded setup
Worktrunk post-start hook reaches observer when socket is available
Worktrunk hook auto-starts observer when socket is unavailable
Worktrunk hook spools only when auto-start or delivery fails
observer reconciles after Worktrunk hook ingestion
provider-native metadata is preferred over in-worktree breadcrumbs when available
in-worktree breadcrumb behavior requires explicit project opt-in
hook body contains no lifecycle logic beyond calling wosm
```

Optional smoke tests:

```text
real wt list in temp project
real wt create in temp project
real wt remove in temp project
real Worktrunk hook fires into wosm hook receiver
```

### Red-first expectations

Tests fail because WorktrunkProvider, Worktrunk hook plan/apply/uninstall, and Worktrunk hook ingestion do not exist.

### Acceptance criteria

```text
Observer can list real or fake Worktrunk worktrees for multiple configured projects.
External Worktrunk lifecycle events can wake observer, notify it, and trigger reconcile.
Hook setup is explicit, backed up, reversible, and doctor-verifiable.
TUI-facing snapshot remains provider-neutral.
Hooks are notification hints, not source of truth.
No shell lifecycle logic is added.
```

### Exit artifacts

```text
integrations/worktree/worktrunk/src/provider.ts
integrations/worktree/worktrunk/src/parse.ts
integrations/worktree/worktrunk/src/hooks.ts
integrations/worktree/worktrunk/test/*
Worktrunk hook fixtures
Worktrunk hook install/uninstall fixtures
```

### Risks

Risk: Raw `wt` output shape is unstable.

Mitigation: Prefer structured output if available. Keep parsing isolated in provider code with fixtures.

Risk: Hooks become hidden truth.

Mitigation: Every hook triggers reconciliation. The graph updates only after provider reconciliation, not from raw hook payload alone.

---

## 12. Phase 8 - Terminal provider reference implementation

### Goal

Implement the first TerminalProvider using tmux while keeping the core terminal-neutral. The MVP tmux topology is one global `wosm` workbench session with one window per worktree and one primary agent pane per worktree.

### Non-goals

```text
No Ghostty provider.
No Warp provider.
No Codex launch yet.
No multiple first-class terminal targets per worktree in v1.
```

### Build scope

```text
TerminalProvider interface finalization
TmuxProvider
global wosm workbench session
one window per worktree
one primary agent pane per worktree window
listTargets
openWorkspace
focusTarget
closeTarget
captureTarget if supported
terminal identity binding
popup command over the workbench
provider health
```

### Test pack

```text
fake tmux list output parses
TerminalTargetObservation normalizes target state
openWorkspace creates or reuses the wosm workbench session
openWorkspace creates one window per worktree
openWorkspace identifies the primary agent pane as the primary target
focus stale target maps to TerminalProviderError
focusTarget focuses the worktree window and primary agent pane
identity binding is provider-specific and normalized
observer correlates terminal target with worktree/session
popup command starts TUI client path without provider access
core observer tests do not assert tmux IDs except through normalized observations
```

Optional real tmux smoke tests:

```text
create temporary wosm test workbench session
create one window per test worktree
create one primary agent pane per window
set provider-specific identity binding
list target
focus target
close target/window
cleanup
```

### Red-first expectations

Tests fail because TerminalProvider and TmuxProvider do not exist.

### Acceptance criteria

```text
Observer can observe and focus the primary primary-agent terminal target through provider contracts.
TUI can dispatch terminal.focus through observer without importing tmux code.
The tmux provider uses the workbench topology without making core code tmux-shaped.
The user experiences one wosm workbench containing many agent windows.
```

### Exit artifacts

```text
integrations/terminal/tmux/src/provider.ts
integrations/terminal/tmux/src/parse.ts
integrations/terminal/tmux/src/popup.ts
terminal provider tests
workbench topology tests
```

### Risks

Risk: Core code becomes tmux-shaped.

Mitigation: Core only consumes TerminalTargetObservation and TerminalCapabilities. tmux session/window/pane IDs live in providerData or diagnostics.

Risk: The global workbench session is killed.

Mitigation: Observer marks terminal targets stale and can recreate/focus windows after reconcile.

---

## 13. Phase 9 - Harness subsystem and scripted agent

### Goal

Implement the harness provider contract and prove agent lifecycle with a deterministic scripted agent before real Codex/OpenCode. The status model must be confidence-based from the beginning.

### Non-goals

```text
No real Codex requirement yet.
No real OpenCode requirement yet.
No model-dependent CI.
No forced high-confidence idle/working labels when signals are ambiguous.
```

### Build scope

```text
HarnessProvider interface finalization
HarnessLaunchPlan
HarnessRunObservation
HarnessStatusObservation
ScriptedAgentHarnessProvider
fake raw event ingestion
process/run discovery abstraction
status classification policy
confidence and reason policy
```

### Test pack

```text
buildLaunch returns a launch plan
scripted agent starts and exits
scripted agent modifies expected file
observer sees starting -> working -> idle/exited
raw fake event maps to normalized observation
unknown signals produce unknown low-confidence status
ambiguous inactivity does not produce high-confidence idle
recent activity can produce working with medium confidence
reliable attention event can produce needs-attention with high confidence
unexpected process exit maps to exited
```

### Red-first expectations

Tests fail because harness subsystem, scripted agent, and confidence-policy classification do not exist.

### Acceptance criteria

```text
Wosm can launch and observe a deterministic agent-like process.
Agent lifecycle tests run in standard CI.
No real model or subscription is required.
Status observations include state, confidence, and reason.
Unknown is acceptable when the provider cannot prove a richer state.
```

### Exit artifacts

```text
integrations/harness/scripted or tests/support/fake-agent
integrations/harness/codex skeleton
integrations/harness/opencode skeleton
harness contract tests
confidence-policy tests
scripted-agent tests
```

### Risks

Risk: Scripted agent becomes too fake to be useful.

Mitigation: It must exercise actual launch, process, event, status, file-change, and debug-bundle paths.

Risk: Confidence model becomes decorative.

Mitigation: Tests must assert confidence and reason, not just status value.

---

## 14. Phase 10 - Create/start session vertical slice

### Goal

Build the first complete vertical product workflow using provider contracts.

By the end of this phase, a user or test should be able to create a session from a project, get a worktree, open that worktree's primary agent target in the tmux workbench, launch a scripted agent, observe status, and focus the worktree window/agent pane.

### Non-goals

```text
No polished TUI yet.
No real Codex requirement yet.
No second harness.
No complex cleanup flows.
```

### Build scope

```text
session.create command
session.startAgent command
observer command router
worktree create/open flow
terminal open/focus flow for the global workbench and primary agent target
harness launch flow into the primary agent pane
SQLite session records
command events
snapshot update events
```

### Test pack

```text
session.create accepted -> running -> succeeded
session.create failure maps to SafeError and diagnostic record
session.startAgent works on existing no-agent worktree
command queue serializes per worktree/session
snapshot updates after command success
focus command works after create and selects the primary agent target
```

### Red-first expectations

Tests fail because command router and vertical flow do not exist.

### Acceptance criteria

```text
A fake-provider or scripted-agent E2E can run the full lifecycle.
Debug bundle explains both successful and failed session.create commands.
The vertical slice preserves one primary agent target per worktree.
```

### Exit artifacts

```text
apps/observer/src/commands/sessionCreate.ts
apps/observer/src/commands/sessionStartAgent.ts
E2E full-session-lifecycle test
scripted-agent lifecycle test
```

### Risks

Risk: Command path becomes a tangle.

Mitigation: Use command router, command queue, provider registry, and Effect boundary wrappers from earlier phases.

---

## 15. Phase 11 - TUI read and command UX

### Goal

Build the Ink TUI as a client of observer snapshots/events/commands. The TUI may use Effect in observer-client IO and command orchestration, but it remains provider-neutral and does not derive runtime truth.

### Non-goals

```text
No direct provider calls from TUI.
No provider-specific parsing in TUI.
No terminal or harness logic in React components.
No raw provider parsing in TUI Effect code.
```

### Build scope

```text
TUI observer client
Effect-aware TUI service layer for observer connection/event subscription/command dispatch
initial snapshot load
event subscription
project-first layout
worktree rows
status rendering
slot mapping
search
group/collapse
command prompts
idle-agent focus-only UX
reserved/disabled prompt-send guard
SafeError toasts
concise diagnostic IDs for failed commands
no provider-data inspect panel in v1
```

### Test pack

```text
renders multiple projects
renders project with zero worktrees
renders no-agent row
renders idle row
renders working row
renders needs-attention row
renders stuck/exited/unknown rows
unknown rows remain visible inside project groups and are not top-level alerts by default
slot mapping dispatches terminal.focus
no-agent row can dispatch session.startAgent
prompt flow dispatches session.create
idle row focuses terminal instead of sending prompt
session.sendPrompt is hidden/disabled unless harness capability allows it
SafeError toast displays safe message and diagnosticId
TUI does not expose providerData or raw provider debug views
TUI does not import provider packages
TUI Effect service layer maps protocol errors to SafeError/diagnostic IDs without leaking raw provider data
```

### Red-first expectations

Tests fail because TUI components and observer client integration do not exist.

### Acceptance criteria

```text
TUI can operate against fake observer snapshots and live observer protocol.
Idle-agent interaction is focus-only in v1.
Unknown rows are visible inside project groups and are not alerts by default.
No TUI inspect/debug panel ships in v1.
TUI owns presentation state and IO orchestration only.
Provider imports are forbidden by lint/test rule.
Effect usage stays in TUI service hooks/boundaries, not presentation components.
```

### Exit artifacts

```text
apps/tui/src/*
apps/tui/test/*
TUI render fixtures
TUI observer-client tests
```

### Risks

Risk: TUI starts deriving runtime truth.

Mitigation: TUI selectors may filter/sort/group rows. They may not infer agent status from raw provider details.

---

## 16. Phase 12 - Provider hook hardening, observer auto-start, and spool fallback

### Goal

Harden the shared provider event ingestion system now that Worktrunk hooks are first-class. Prove hook-triggered observer auto-start, bounded delivery, fallback spool, and provider-neutral harness hook ingestion.

### Non-goals

```text
No assumption that every harness has hooks.
No raw provider payloads in observer core.
No TUI hook parsing.
No replacing reconciliation with hook payloads.
```

### Build scope

```text
hook ingestion API hardening
CLI hook receiver hardening
hook-triggered observer auto-start hardening
bounded startup and delivery timeout
fallback spool durability
spool drain on observer startup
ProviderHookEvent types
provider-specific ingestEvent methods
normalized observation output
hook install/uninstall command expansion
hook diagnostics and redaction
```

### Test pack

```text
hook event reaches observer when socket is available
hook event auto-starts observer when socket is unavailable
hook event is delivered after observer startup
hook event writes spool file only when startup or delivery fails
observer drains spool on startup
invalid hook payload is rejected safely
hook ingestion produces normalized observation
hook ingestion triggers reconcile before graph update
hook ingestion updates events and provider health
redaction applies to hook payloads
Worktrunk hook fixtures
Worktrunk hook install/uninstall fixtures remain green
harness hook fixture can be added without changing observer core
```

### Red-first expectations

Tests fail because hook ingestion, observer auto-start, bounded delivery, and fallback spool behavior are not yet hardened across provider kinds.

### Acceptance criteria

```text
Worktrunk hook support from Phase 7 remains working.
Hook events can auto-start observer and deliver provider events.
Hook events can update observer state through provider contracts.
Hook auto-start is bounded, nonblocking, rate-limited, and diagnosable.
Fallback hook spool is reliable and diagnosable.
Hook files are not source of truth.
Worktrunk hook support remains first-class.
Harness hook support can be added without observer schema changes.
```

### Exit artifacts

```text
apps/cli/src/commands/hook.ts
apps/observer/src/hookIngestion.ts
hook auto-start tests
spool fallback tests
hook ingestion tests
provider hook fixtures
```

### Risks

Risk: Hook-triggered startup becomes surprising or slow.

Mitigation: Bound startup and delivery time, log auto-start decisions, rate-limit starts, and fall back to spool instead of blocking provider commands.

---

## 17. Phase 13 - Real Codex provider

### Goal

Implement the first real HarnessProvider while preserving provider-neutral core contracts.

### Non-goals

```text
No real-agent tests in standard CI.
No Codex-specific fields in TUI.
No observer core dependency on Codex payload shape.
```

### Build scope

```text
CodexProvider
launch plan generation
capability declaration
process/run discovery when possible
event ingestion when supported
confidence-based status classification
provider-specific diagnostics
real-agent opt-in tests
```

### Test pack

```text
Codex launch plan uses safe argv/env shape
Codex capabilities are declared
Codex raw events parse through provider only
Codex failures map to HarnessProviderError
Codex observations normalize to HarnessRunObservation with confidence and reason
Codex incomplete signals map to unknown instead of false idle/working
optional real Codex sandbox scenario
```

### Red-first expectations

Tests fail because CodexProvider behavior is absent.

### Acceptance criteria

```text
Codex can be launched through session.create or session.startAgent in a sandbox.
Codex status is conservative and confidence-based.
Observer and TUI require no schema rewrite.
Failures generate useful debug bundles.
```

### Exit artifacts

```text
integrations/harness/codex/src/provider.ts
integrations/harness/codex/test/*
tests/agent/real/codex/*
```

### Risks

Risk: Codex signals are incomplete or unstable.

Mitigation: Use capabilities and confidence. Unknown low-confidence is valid. Do not invent certainty.

---

## 18. Phase 14 - Cleanup, safety, and removal flows

### Goal

Add safe close/remove flows and guardrails.

### Non-goals

```text
No complicated merge/rebase workflows.
No destructive behavior without explicit confirmation.
```

### Build scope

```text
session.close command
terminal.close command
worktree.remove command
dirty guard
running-agent guard
force flag
TUI confirmation prompts
command failure diagnostics
```

### Test pack

```text
cannot remove dirty worktree without confirmation/force
cannot remove working agent without guarded flow
close agent only
close terminal only
close all
stale terminal close produces typed error
remove command records events and logs
```

### Red-first expectations

Tests fail because cleanup commands do not exist.

### Acceptance criteria

```text
User can close and remove safely.
Dangerous operations are guarded.
Debug bundles explain failed cleanup commands.
```

### Exit artifacts

```text
cleanup command handlers
TUI confirm flows
cleanup tests
```

### Risks

Risk: Cleanup becomes too aggressive.

Mitigation: Default to safe, explicit, reversible where possible. Never delete work without guard checks.

---

## 19. Phase 15 - Diagnostics hardening and agent-diagnosis tests

### Goal

Harden diagnostics, provider-specific failure evidence, and agent-diagnosis scenarios after real providers begin landing.

### Non-goals

```text
No public telemetry export required.
No cloud service.
No non-local diagnostics by default.
```

### Build scope

```text
wosm debug bundle provider-hardening
redaction hardening
provider health reports
reconcile timing reports
recent command/event/log correlation
diagnostic IDs in TUI/CLI
CLI-first provider diagnostics
snapshot --json support for debugging
agent-diagnosis scenarios
injected failure tests
```

### Test pack

```text
missing Worktrunk binary diagnostic
stale terminal target diagnostic
invalid config diagnostic
hook auto-start and spool-fallback diagnostic
provider timeout diagnostic
harness unexpected exit diagnostic
SQLite write failure diagnostic
agent can classify diagnostic bundle or deterministic oracle can validate bundle evidence
common row-level provider questions are answerable from CLI/debug-bundle output without a TUI inspect panel
```

### Red-first expectations

Tests fail because provider-specific diagnostics and injected-failure evidence are incomplete.

### Acceptance criteria

```text
Common failures are diagnosable from one bundle.
Runtime doctor and debug bundle agree on core health facts.
TUI exposes diagnostic IDs.
CLI can produce redacted bundles.
Agent-diagnosis tests pass with scripted or oracle-based classifier.
```

### Exit artifacts

```text
apps/cli/src/commands/debugBundle.ts
apps/cli/src/commands/doctor.ts
packages/observability diagnostic helpers
tests/diagnostics/*
tests/agent/scenarios/diagnosis/*
```

### Risks

Risk: Debug bundles leak secrets.

Mitigation: Redaction tests are mandatory. Real env/config fixtures must use fake values.

---

## 20. Phase 16 - Real E2E and dogfood baseline

### Goal

Prove the system works as a product in realistic local workflows.

### Non-goals

```text
No broad terminal-provider matrix.
No broad harness-provider matrix.
No polishing every possible feature.
```

### Build scope

```text
full lifecycle E2E
observer restart tests
SQLite deletion recovery behavior
terminal stale-target recovery
hook offline replay
real tmux workbench lane
real Worktrunk lane
Worktrunk hook online/offline lane
optional real Codex/OpenCode lane
dogfood checklist
```

### Test pack

```text
create worktree -> open primary agent target -> launch agent -> observe working -> idle/exited
start agent on existing worktree
focus primary agent target from TUI
remove no-agent worktree
observer killed and restarted
Worktrunk hook fires while observer online
Worktrunk hook fires while observer offline
SQLite deleted and dashboard partially recovers
terminal target stale and reconciled
real tmux workbench target focus
tmux workbench has one session with windows per worktree
real Worktrunk list/create/remove in temp project
Worktrunk hook install/uninstall and offline hook replay
```

### Red-first expectations

Tests fail because recovery and real-tool lanes are incomplete.

### Acceptance criteria

```text
wosm is dogfoodable.
The default local workflow works end to end.
The global wosm workbench can show multiple worktree windows.
Worktrunk hooks notify or spool correctly.
Failures are diagnosable.
Standard CI remains deterministic.
Real-agent tests are opt-in.
```

### Exit artifacts

```text
tests/e2e/full-session-lifecycle/*
tests/e2e/recovery/*
tests/agent/real/*
dogfood checklist
release readiness checklist
```

### Risks

Risk: Real E2E becomes flaky.

Mitigation: Keep standard CI on fake/scripted providers. Real lanes are opt-in, nightly, or manually triggered.

---

## 21. Phase 17 - Second harness provider

### Goal

Add OpenCode or another second harness to prove the provider model is real.

### Non-goals

```text
No observer schema rewrite.
No TUI provider-specific behavior beyond display labels and choices.
No harness-specific status assumptions in core.
```

### Build scope

```text
OpenCodeProvider or chosen second harness
provider capabilities
launch plan
status classification
provider-specific diagnostics
harness selection UI
contract tests
optional real-agent tests
```

### Test pack

```text
second harness passes shared HarnessProvider contract tests
second harness launch plan is provider-specific but normalized
observer can switch default harness by project config
TUI can start agent with selected harness
errors normalize to HarnessProviderError/SafeError
no observer/TUI schema rewrite required
```

### Red-first expectations

Tests fail because second harness behavior is absent.

### Acceptance criteria

```text
Adding a second harness does not require rewriting observer, protocol, or TUI contracts.
Provider-neutral design is validated by implementation.
```

### Exit artifacts

```text
integrations/harness/opencode/src/provider.ts or equivalent
second harness tests
harness selection UI tests
```

### Risks

Risk: Second harness reveals missing contract fields.

Mitigation: Adjust contracts only if the need is provider-neutral. Do not add provider-specific fields to core models.

---

## 22. Phase 18 - Release hardening

### Goal

Prepare the first real release or serious dogfood checkpoint.

### Non-goals

```text
No feature expansion.
No new provider unless required for release.
No broad refactor without test coverage.
```

### Build scope

```text
installer/bootstrap
upgrade/migration behavior
doctor command completeness, including project-local config and Worktrunk hook setup status
README and docs
example config
known issues
release notes
smoke test script
```

### Test pack

```text
fresh install smoke
missing dependency doctor output
bad config doctor output
observer startup smoke
TUI startup smoke
debug bundle smoke
scripted-agent smoke
real tmux smoke where available
```

### Red-first expectations

Tests fail because installation and doctor behavior are incomplete.

### Acceptance criteria

```text
A new machine can install and run the scripted-agent workflow from docs.
Doctor catches common setup errors.
Debug bundle is available for support.
Release checklist is complete.
```

### Exit artifacts

```text
install docs
example config
release checklist
smoke tests
first release tag or dogfood milestone
```

### Risks

Risk: Release hardening turns into feature addition.

Mitigation: Freeze feature scope. Only fix blockers, docs, diagnostics, and install flow.

---

## 23. Ongoing development cycle after Phase 18

After the first release/dogfood checkpoint, new features should follow the same pattern:

```text
1. Define the new behavior in contracts or provider capabilities if needed.
2. Add fixtures.
3. Add failing tests.
4. Implement the smallest vertical slice.
5. Add diagnostic coverage for likely failures.
6. Update docs and examples.
```

Every provider addition should prove:

```text
shared contract tests pass
provider-specific tests pass
observer remains provider-neutral
TUI remains provider-neutral
SafeError and debug bundle behavior work
```

Every new command should prove:

```text
validation
receipt
queueing
execution
success event
failure event
SafeError
debug-bundle evidence
```

---

## 24. Suggested implementation milestones

A practical milestone grouping:

```text
Milestone A: Architecture testbed
  Phases 0-3
  Outcome: contracts, config, observer graph with fake providers.

Milestone B: Runtime shell
  Phases 4-6
  Outcome: persistence, protocol, CLI startup, runtime boundary, doctor, and operational debug bundle with fake providers.

Milestone C: Real provider foundations
  Phases 7-9
  Outcome: Worktrunk with hooks, tmux workbench, harness contract, scripted agent.

Milestone D: First vertical product slice
  Phases 10-12
  Outcome: create/start session, TUI, provider hook hardening.

Milestone E: Real harness and safe cleanup
  Phases 13-14
  Outcome: Codex, guarded cleanup flows.

Milestone F: Diagnosable dogfood
  Phases 15-16
  Outcome: debug bundles, agent diagnosis, realistic E2E, dogfood readiness.

Milestone G: Provider validation and release
  Phases 17-18
  Outcome: second harness, release hardening.
```

---

## 25. V1 sequencing baseline

The final V1 sequencing choices are:

```text
Effect:
  Standardize a small @wosm/runtime subset early.
  Use it in observer/CLI/provider/hook/TUI IO boundaries.
  Keep React components and pure contracts plain.

Debug bundle:
  Operational bundle before real providers.
  Provider-specific hardening later.

OpenTelemetry:
  Stable trace/span IDs and operation names in V1.
  Export disabled or no-op by default.

Retention:
  Bounded local retention appears in doctor and tests.

TUI:
  Provider-neutral, no inspect panel in v1, no prompt sending in v1.
  Effect may be used in observer-client orchestration only.
```

---

## 26. Final rule


The development plan should remain subordinate to the architecture.

If implementation pressure creates a temptation to bypass contracts, call providers from the TUI, put runtime logic in shell, make Codex/tmux concepts core, or skip diagnostic coverage, the phase should stop and the architecture should be corrected first.

The rebuild succeeds only if each phase leaves the system more coherent than it found it.
