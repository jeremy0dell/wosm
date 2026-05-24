# Terminal Ownership P0 Blocker Fix Plan

**Status:** Planning addendum
**Date:** 2026-05-24
**Severity:** P0 blocker
**Applies to:** terminal ownership, session lifecycle, observer command routing
**Source baseline:** `docs/planning/wosm_rebuild_tdd_final_v1.md` and `docs/planning/wosm_phased_development_cycle_final_v1.md`

This document plans the P0 fix for the confirmed blocker in the current terminal boundary.

The target vision is that a terminal integration can own its own topology and lifecycle. A bare Ghostty integration should be able to keep the TUI in one Ghostty window and agent sessions in another Ghostty window with tabs, without observer understanding or coordinating the window/tab mechanics.

## 0. Authority And Conflict Rule

This addendum supersedes older terminal command-path examples in the baseline TDD and phased plan where those examples show observer directly opening terminal workspaces, building harness launch plans for terminal execution, launching terminal processes, or focusing/closing terminal targets by provider target id.

Those older examples remain useful as product-flow descriptions, but they must not be used as implementation authority for terminal ownership. For terminal command routing, use this addendum as the source of truth until the baseline TDD and phased plan are revised.

## 1. Problem

The current implementation lets observer coordinate terminal actions directly.

Confirmed current shape:

```text
apps/observer/src/commands/session/create.ts
  observer calls terminal.openWorkspace(...)
  observer asks harness.buildLaunch(...)
  observer calls terminal.launchProcess(...)
  observer optionally calls terminal.focusTarget(...)

apps/observer/src/commands/session/startAgent.ts
  same terminal-open and terminal-launch orchestration for existing worktrees

apps/observer/src/commands/terminal.ts
  observer resolves a terminal target from snapshot state
  observer calls terminal.focusTarget(...)
  observer calls terminal.closeTarget(...)

packages/contracts/src/providers.ts
  TerminalProvider exposes imperative terminal controls:
    openWorkspace
    launchProcess
    focusTarget
    closeTarget
    captureTarget
    sendInput
```

This blocks the wanted Ghostty model because observer is currently the process that decides when the terminal should open, launch, focus, and close targets. The terminal integration owns mechanics behind each method, but observer still owns the workflow.

## 2. Boundary Target

Observer should accept product-level commands and own their command lifecycle:

```text
accept command
validate configured project/worktree/session references
record command state
publish product intent
correlate provider observations into snapshots
surface command/event/trace/diagnostic state
```

Terminal integrations should own terminal lifecycle:

```text
decide where the TUI belongs
decide where agent workspaces belong
create or reuse windows/tabs/panes
bind terminal identity to worktrees/sessions
focus provider-owned targets
close provider-owned targets
launch or attach provider-owned terminal processes
report normalized observations back to observer
```

Observer may route a typed product intent. Observer should not perform the terminal workflow step-by-step.

## 3. Contract Direction

Split terminal responsibilities into observation and intent handling.

Keep provider-neutral observation:

```ts
export interface TerminalObservationProvider {
  id: ProviderId;
  capabilities(): TerminalCapabilities;
  health(): Promise<ProviderHealth>;
  doctorChecks?(context?: ProviderDoctorContext): Promise<ProviderDoctorCheck[]>;
  listTargets(): Promise<TerminalTargetObservation[]>;
  ingestEvent?(
    event: RawTerminalEvent,
    context: TerminalEventContext,
  ): Promise<TerminalTargetObservation[]>;
}
```

Move imperative workflow methods out of observer's core orchestration surface.

Introduce provider-owned terminal intents as product-level requests:

```ts
export type TerminalIntent =
  | {
      type: "session.ensureAgentWorkspace";
      commandId: CommandId;
      project: ProviderProjectConfig;
      worktree: WorktreeObservation;
      sessionId: SessionId;
      harness: ProviderId;
      mode?: "interactive" | "exec";
      initialPrompt?: string;
      profile?: string;
      approvalPolicy?: string;
      sandboxMode?: string;
    }
  | {
      type: "terminal.focusWorktree";
      commandId: CommandId;
      projectId: ProjectId;
      worktreeId: WorktreeId;
      sessionId?: SessionId;
      origin?: TerminalFocusOrigin;
    }
  | {
      type: "terminal.closeWorktree";
      commandId: CommandId;
      projectId?: ProjectId;
      worktreeId: WorktreeId;
      sessionId?: SessionId;
      force?: boolean;
    };
```

The exact type names can change during implementation. The invariant is the important part: observer emits product intent, terminal integration owns terminal mechanics.

Terminal intent receipts should be explicit about what has happened:

```ts
export type TerminalIntentReceipt =
  | {
      commandId: CommandId;
      provider: ProviderId;
      status: "accepted";
      acceptedAt: string;
    }
  | {
      commandId: CommandId;
      provider: ProviderId;
      status: "completed";
      completedAt: string;
    }
  | {
      commandId: CommandId;
      provider: ProviderId;
      status: "rejected";
      rejectedAt: string;
      error: SafeError;
    };
```

Receipt meaning:

```text
accepted:
  the terminal-owned runtime has durably accepted responsibility for the intent
  terminal workspace/process completion is not yet proven

completed:
  the terminal-owned runtime completed the requested terminal action inside a bounded call
  observer may still reconcile from normalized observations rather than trusting topology details

rejected:
  the terminal-owned runtime refused the intent before taking responsibility
  observer should fail the command with the SafeError
```

Do not include provider topology fields such as pane id, window id, tab id, session name, tmux options, or Ghostty window/tab ids in terminal intents or receipts.

## 4. Session Workflow Target

For `session.create`:

```text
observer validates project and branch input
observer asks worktree provider to create the worktree
observer records an accepted session intent
terminal integration handles terminal workspace creation and harness startup
terminal integration reports observations/events
observer reconciles observations into row/session state
```

For `session.startAgent`:

```text
observer validates project/worktree input
observer records an accepted start-agent intent
terminal integration handles workspace selection, tab/window creation, and harness startup
terminal integration reports observations/events
observer reconciles observations into row/session state
```

For focus:

```text
TUI/CLI sends focus-by-worktree or focus-by-session intent
observer validates the referenced worktree/session exists when possible
terminal integration resolves the provider-owned target
terminal integration performs focus according to its own topology
```

For close:

```text
TUI/CLI sends close-by-worktree or close-by-session intent
observer validates cleanup policy and force requirements
terminal integration resolves and closes provider-owned target(s)
terminal integration reports observations/events
observer reconciles removal/stale state
```

### 4.1 Command Lifecycle Semantics

The observer command lifecycle and terminal intent lifecycle are related but not the same lifecycle.

Command receipt:

```text
CommandReceipt accepted:
  observer validated the command shape, recorded the command, and queued execution

CommandReceipt rejected:
  observer rejected the command before queueing
```

Command execution:

```text
command.started:
  observer began the queued command

command.succeeded for terminal-owned work:
  observer completed observer-owned work and received an accepted or completed terminal intent receipt

command.failed:
  observer validation failed during execution, observer-owned work failed, or the terminal intent sink rejected the intent
```

For `session.create`, observer-owned work includes project validation, one-primary-agent policy checks, worktree creation, command persistence, and terminal intent submission. A `command.succeeded` event after an `accepted` terminal receipt does not prove that the terminal workspace exists or that the agent process is running. Those facts must appear through terminal/harness observations, intent result events, diagnostics, and subsequent snapshots.

The first in-process tmux implementation may return `completed` when it can finish workspace creation, harness launch, focus, or close inside a bounded provider-owned call. The observer still must treat the returned result as a receipt, not as permission to inspect or coordinate terminal topology.

### 4.2 Intent Idempotency

Terminal intents must be idempotent by `commandId` plus intent type.

Requirements:

```text
re-submitting the same commandId and intent type returns the same logical receipt
session.ensureAgentWorkspace must not launch duplicate primary agents for the same sessionId
focus intents may be repeated without changing ownership state
close intents may be repeated and should converge on closed/stale/missing state
idempotency records live behind the terminal-owned runtime or session runner boundary
observer tests must prove duplicate submitIntent calls do not produce duplicate terminal workflow calls
```

This is required because observer command retry, process restart, or socket reconnection must not create duplicate terminals or duplicate agents.

### 4.3 Compensation And Rollback

The current implementation rolls back terminal targets and newly created worktrees in the same observer call path. After this fix, rollback responsibility must follow ownership.

Rules:

```text
if worktree creation fails before intent submission, observer fails the command
if session.create creates a worktree and terminal intent submission is rejected, observer should best-effort remove the new worktree
if terminal intent is accepted and later terminal/harness launch fails, observer should not automatically remove the worktree
if terminal-owned runtime creates terminal resources and fails before accepting responsibility, terminal-owned runtime owns terminal cleanup
if terminal-owned runtime accepts responsibility and later fails, it reports failure through intent events, diagnostics, and observations
explicit user cleanup commands handle accepted-but-failed sessions/worktrees
```

This keeps observer from making provider-specific cleanup assumptions after the terminal owner has taken responsibility.

### 4.4 Preferred Runtime Composition

The preferred P0 implementation shape is a provider-owned session runner or terminal intent handler outside observer command handlers.

Recommended ownership:

```text
observer command handler:
  validates product references
  creates worktree when product command requires it
  submits one terminal intent

session runner or terminal intent handler:
  composes terminal provider and harness provider capabilities
  asks harness provider to build launch syntax
  asks terminal provider to create/reuse/focus/close provider-owned targets
  records provider-owned idempotency state
  reports normalized observations, intent result events, diagnostics, and SafeError failures

terminal provider:
  owns terminal topology, identity binding, process placement, focus, close, capture, and input mechanics

harness provider:
  owns harness-specific command construction, discovery, event ingestion, and status classification
```

The terminal provider should not become the owner of harness-specific semantics. If an implementation lets a terminal intent handler ask a harness provider for a launch plan, that handler is acting as the session runner boundary, not as observer core.

## 5. Implementation Sequence

### P0.1 Characterize The Current Blocker

Add focused tests that fail under the desired model.

Tests:

```text
observer session.create accepts a product intent without calling terminal.openWorkspace
observer session.startAgent accepts a product intent without calling terminal.openWorkspace
observer does not call terminal.launchProcess during command handling
observer terminal.focus does not require a terminal target id in the snapshot
observer terminal.close does not require a terminal target id in the snapshot
```

These tests should use fake providers and a fake terminal-intent sink. They should prove observer command handlers no longer execute terminal mechanics.

### P0.2 Add Terminal Intent Contracts

Add strict schemas and types for terminal intents and terminal intent receipts.

Contracts should include:

```text
intent id or command id
intent type
project/worktree/session references
harness request options needed by the terminal integration
origin metadata for focus
force metadata for close
typed accepted/rejected/result states
SafeError on failure
idempotency semantics for duplicate commandId submissions
```

Do not include provider topology fields such as pane id, window id, tab id, session name, or tmux options.

### P0.3 Add A Terminal Intent Sink

Add a delivery boundary that observer can publish to without owning terminal mechanics.

Possible shape:

```ts
export interface TerminalIntentSink {
  providerId: ProviderId;
  submitIntent(intent: TerminalIntent): Promise<TerminalIntentReceipt>;
}
```

This sink is not a replacement name for `openWorkspace`, `launchProcess`, `focusTarget`, or `closeTarget`. It is a command-log/event delivery boundary. The terminal-owned runtime can be in-process for the first implementation, but tests must treat it as an independent owner of terminal workflow.

The first implementation can be in-process if needed, but ownership must be tested at the boundary:

```text
observer command handlers submit one product intent
observer command handlers do not call open/focus/close/launch mechanics
terminal integration tests own the mechanics behind intent handling
duplicate commandId submissions do not duplicate terminal workflow
```

### P0.4 Move Session Terminal Workflow Out Of Observer

Change `session.create` and `session.startAgent` command handlers so they stop sequencing terminal operations.

Observer should still:

```text
validate project/worktree references
enforce "one primary agent" policy from current snapshot
create worktrees for session.create
record command state
submit terminal intent
publish command/session-intent events
trigger reconcile after receipt or observation
apply rollback only before terminal-owned runtime has accepted responsibility
```

Observer should stop:

```text
calling terminal.openWorkspace
building a synthetic terminal observation from returned binding
calling harness.buildLaunch as part of observer terminal workflow
calling terminal.launchProcess
best-effort closing an opened terminal target on launch failure
best-effort focusing a provider target by id after launch
waiting indefinitely for provider-owned terminal startup to become observable
```

The terminal integration or a provider-owned session runner should own those mechanics.

### P0.5 Move Focus And Close Resolution Out Of Observer

Change focus and close command handling to submit product-level intents.

Observer should resolve only product references:

```text
worktree id
session id
project id when required
force policy
origin metadata
```

Observer should not resolve provider targets from row/session terminal fields before focus/close.

### P0.6 Update The tmux Integration To Handle The New Intent Boundary

The tmux integration remains the reference implementation.

tmux should own:

```text
workbench session creation
window/pane selection
@wosm.* identity binding
pane launch
focus target mechanics
close target mechanics
popup-specific routing when used by CLI/TUI
```

Observer should only see normalized observations and intent receipts.

### P0.7 Preserve Harness Ownership

Harness command syntax must remain harness-owned.

The preferred shape is a provider-owned session runner that composes terminal and harness capabilities outside observer command handlers.

Acceptable implementation shape:

```text
provider-owned session runner receives TerminalIntent
session runner asks harness provider for a launch plan through injected harness capability
session runner asks terminal provider to run the launch plan in a provider-owned location
session runner reports normalized observations, receipts, diagnostics, and failures
```

A direct terminal intent handler may implement this shape internally, but these invariants must hold:

```text
observer does not build terminal launch workflow
observer does not call harness.buildLaunch for terminal execution
harness provider still owns harness-specific command construction
terminal integration or session runner owns where/how the command runs
```

## 6. Acceptance Criteria

P0 is fixed when:

```text
apps/observer/src/commands/session/create.ts does not call terminal.openWorkspace
apps/observer/src/commands/session/startAgent.ts does not call terminal.openWorkspace
apps/observer command handlers do not call terminal.launchProcess
apps/observer/src/commands/terminal.ts does not call terminal.focusTarget or terminal.closeTarget directly
observer focus/close commands can be expressed by worktree/session reference without targetId
tmux behavior still works through the new terminal-owned intent boundary
fake terminal intent tests prove a second terminal integration can own topology
observer snapshots still show worktree/agent/session status from normalized observations
diagnostics still report command failures with trace ids and SafeError payloads
command.succeeded for accepted async intents is documented as intent acceptance, not proof of running process
duplicate terminal intents by commandId are idempotent
session.create rollback is limited to pre-acceptance failures
```

## 7. Non-Goals

This P0 plan does not require:

```text
building a Ghostty provider
removing all terminal fields from snapshots
removing all providerData persistence
changing Worktrunk ownership
changing Codex/OpenCode status classification
supporting multiple primary agents per worktree
```

Those are either P1 leakage cleanup or future feature work.

## 8. Verification

Minimum verification for the P0 fix:

```text
pnpm --filter @wosm/contracts test
pnpm --filter @wosm/observer test
pnpm --filter @wosm/tmux test
pnpm test:all
manual tmux smoke: start TUI, start an agent, focus it, close it
fake-provider smoke: terminal intent sink receives product intents without terminal topology
```
