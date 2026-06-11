# Terminal Intent Boundary Refactor Plan

**Status:** Completed planning record (PRs 1-3 implemented; PR 3 notes dated 2026-06-05; moved to completed 2026-06-11)
**Date:** 2026-06-04
**Severity:** P0 architecture refactor
**Applies to:** terminal ownership, session launch, focus/close commands, observer command handlers, tmux integration, harness launch composition
**Related PR 3 detail:** `docs/planning/completed/terminal_leakage_p1_fix.md`

The only open item is an explicit deferral, not pending work: the debug
terminal-target command namespace remains deferred until users demonstrate a
need for target-level operations.

This document is the current plan for fixing the terminal ownership boundary.

It supersedes older terminal command-path examples in the historical rebuild plans and earlier P0 terminal ownership notes where those examples put terminal workflow sequencing directly in observer command handlers or treat a terminal provider as the owner of harness launch orchestration.

The final target is:

```text
observer command handler
  -> DefaultTerminalIntentRunner.submitIntent(...)
      -> terminal provider mechanics
      -> harness provider launch-plan building
  -> observer reconcile/events/command lifecycle
```

The runner is the cross-provider orchestration boundary. It is not the terminal provider, and it is not a new shared terminal package.

## 1. Decision Summary

### 1.1 Go Decision

Proceed with the refactor, but implement it as a runner-based boundary rather than a terminal-provider-owned intent sink.

The direction is necessary because terminal topology is provider-owned, while observer command handlers currently coordinate terminal mechanics step by step. That shape works for tmux, but it does not scale to providers whose natural model is not "one provider target id per workspace or pane."

### 1.2 Final Boundary

```text
apps/observer command handlers:
  validate product references and policy
  create/remove worktrees when that is the product command
  seed/delete observer-owned session metadata
  submit product-level terminal intents
  record command lifecycle, trace ids, command ids, errors, events
  reconcile normalized provider observations into snapshots

apps/observer terminal intent runner:
  composes terminal provider mechanics and harness provider launch planning
  owns the synchronous product-intent workflow for terminal session operations
  resolves focus/close subjects using normalized terminal observations
  applies timeout, cancellation, trace, error, and idempotency behavior

terminal providers:
  own topology and mechanics: windows, tabs, panes, sessions, identity binding,
  open/reuse, process launch placement, focus, close, capture, input

harness providers:
  own harness command construction, launch env, CLI grammar, hooks/events,
  discovery, classification, prompt delivery, and status semantics

packages/contracts:
  owns strict data schemas and shared types for terminal intents and receipts
  does not own the observer runtime runner interface
```

### 1.3 Key Correction From Earlier Plan

Do not make `TerminalProvider.submitIntent(...)` the primary migration path, and do not make `TmuxProvider` resolve harness providers.

That would reduce observer command-handler bloat, but it would create a new muddled boundary where the terminal provider coordinates harness semantics. The correct composition point is the observer provider factory/registry boundary, after independent provider construction.

## 2. Current Problem

The current implementation still has observer command handlers sequencing terminal mechanics directly.

Confirmed current shape:

```text
apps/observer/src/commands/session/create.ts
  validates command payload
  creates worktree
  calls terminal.openWorkspace(...)
  converts terminal identity binding into a terminal observation
  calls harness.buildLaunch(...)
  calls terminal.launchProcess(...)
  optionally calls terminal.focusTarget(...)
  best-effort closes provider target on pre-launch failure

apps/observer/src/commands/session/startAgent.ts
  resolves existing worktree
  calls terminal.openWorkspace(...)
  calls harness.buildLaunch(...)
  calls terminal.launchProcess(...)
  optionally calls terminal.focusTarget(...)
  best-effort closes provider target on pre-launch failure

apps/observer/src/commands/terminal.ts
  resolves a concrete target id from snapshot state
  calls terminal.focusTarget(...)
  calls terminal.closeTarget(...)

apps/tui/src/state/commandBuilders.ts
  prefers row.terminal.primaryAgentTargetId or row.terminal.workspaceTargetId
  when building focus and close commands
```

Why this is a problem:

```text
observer becomes half command ledger and half terminal workflow coordinator
normal product commands become shaped around provider target ids
terminal providers are pressured to expose topology as shared snapshot fields
future terminal providers have to mimic tmux's target model
cleanup and rollback cross provider ownership boundaries
tests train observer behavior around terminal target mechanics
```

The architecture docs already define the desired ownership:

```text
terminal providers are authoritative for terminal topology and provider-owned target identity
harness providers are authoritative for agent launch, discovery, event ingestion, and status signals
observer owns correlation, commands, persistence, diagnostics, and snapshots
TUI dispatches typed commands and must not inspect provider mechanics
```

## 3. Non-Goals

This P0 plan does not require:

```text
building a Ghostty provider
creating integrations/terminal/shared
removing all terminal fields from snapshots
removing all providerData persistence
removing low-level TerminalProvider methods
changing Worktrunk ownership
changing harness status classification
supporting multiple primary agents per worktree
making terminal intent idempotency durable across observer restarts
```

Those are either P1 leakage cleanup, future terminal provider work, or later hardening.

## 4. Final Package And File Shape

### 4.1 Contracts

Add:

```text
packages/contracts/src/terminalIntents.ts
packages/contracts/test/schema/terminal-intents-schema.test.ts
```

Export from:

```text
packages/contracts/src/index.ts
```

Contracts should contain data schemas and inferred types only:

```text
TerminalIntentSchema
EnsureAgentWorkspaceIntentSchema
TerminalFocusIntentSchema
TerminalCloseIntentSchema
TerminalIntentSubjectSchema
TerminalIntentReceiptSchema

type TerminalIntent
type EnsureAgentWorkspaceIntent
type TerminalFocusIntent
type TerminalCloseIntent
type TerminalIntentSubject
type TerminalIntentReceipt
```

Do not put `TerminalIntentRunner` in `packages/contracts`. The runner is not a wire payload, TUI/CLI command schema, provider observation, or protocol data contract. It is an observer runtime orchestration capability.

### 4.2 Observer Runtime

Add:

```text
apps/observer/src/providers/terminalIntentRunner.ts
```

This file owns:

```text
TerminalIntentRunner interface
TerminalIntentSubmitContext type
DefaultTerminalIntentRunner implementation
createTerminalIntentRunner factory
intent idempotency map
subject-to-target resolution using normalized observations
provider mutation boundary wrappers for terminal/harness calls
```

If the file grows too large, split under:

```text
apps/observer/src/terminalIntents/
  runner.ts
  ensureAgentWorkspace.ts
  focus.ts
  close.ts
  subjects.ts
  errors.ts
```

Start with the single file unless the first implementation becomes hard to read.

### 4.3 Provider Registry

Extend the observer registry:

```ts
import type { TerminalIntentRunner } from "./terminalIntentRunner.js";

export type ProviderRegistryInput = {
  worktree: WorktreeProvider;
  terminal: TerminalProvider;
  harnesses: Iterable<HarnessProvider> | Map<string, HarnessProvider>;
  terminalIntentRunner: TerminalIntentRunner;
  repositories?: Iterable<RepositoryProvider> | Map<string, RepositoryProvider>;
};

export class ProviderRegistry {
  readonly worktree: WorktreeProvider;
  readonly terminal: TerminalProvider;
  readonly harnesses: Map<string, HarnessProvider>;
  readonly terminalIntentRunner: TerminalIntentRunner;
  readonly repositories: Map<string, RepositoryProvider>;
}
```

Construction should keep providers independent:

```ts
export function createProviderRegistry(
  config: WosmConfig,
  options: CreateProviderRegistryOptions = {},
): ProviderRegistry {
  const worktree = createWorktreeProvider(config);
  const terminal = createTerminalProvider(config);
  const harnesses = createHarnessProviders(config, options);
  const repositories = createRepositoryProviders(config);
  const terminalIntentRunner = createTerminalIntentRunner({
    terminal,
    harnesses,
  });

  return new ProviderRegistry({
    worktree,
    terminal,
    harnesses,
    terminalIntentRunner,
    repositories,
  });
}
```

This is the important placement decision: cross-provider composition happens at the observer composition root, not inside `TmuxProvider`.

### 4.4 Tmux Integration

Keep `integrations/terminal/tmux` focused on terminal mechanics:

```text
TmuxProvider.openWorkspace(...)
TmuxProvider.launchProcess(...)
TmuxProvider.focusTarget(...)
TmuxProvider.closeTarget(...)
TmuxProvider.listTargets(...)
TmuxProvider.captureTarget(...)
TmuxProvider.sendInput(...)
```

Do not add the whole terminal intent runner to tmux.

If tmux needs stronger target resolution than normalized observations can provide, add a narrow tmux-specific low-level helper or method, for example:

```ts
resolveTargetForSubject?(subject: TerminalIntentSubject): Promise<TerminalTargetId | undefined>;
```

That helper must remain terminal-mechanics-owned. It may understand tmux topology. It must not resolve harness providers, build launch commands, or coordinate WOSM session lifecycle.

### 4.5 No `integrations/terminal/shared` Yet

Do not create `integrations/terminal/shared` in the first implementation.

Reason:

```text
there is currently only one terminal integration: tmux
the reusable data contract belongs in packages/contracts
the reusable orchestration belongs in apps/observer
tmux-specific mechanics belong in integrations/terminal/tmux
```

Create `integrations/terminal/shared` only after a second terminal provider proves real duplication that cannot live cleanly in contracts or observer runtime. Ghostty should be allowed to force the abstraction from real code, not from speculation.

## 5. Terminal Intent Contracts

### 5.1 Intent Types

Proposed first-pass shape:

```ts
export type TerminalIntent =
  | EnsureAgentWorkspaceIntent
  | TerminalFocusIntent
  | TerminalCloseIntent;

export type EnsureAgentWorkspaceIntent = {
  type: "session.ensureAgentWorkspace";
  commandId: CommandId;
  terminalProvider: ProviderId;
  project: ProviderProjectConfig;
  worktree: WorktreeObservation;
  sessionId: SessionId;
  harness: {
    provider: ProviderId;
    mode?: "interactive" | "exec";
    profile?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
  };
  layout?: "default" | "agent-only" | "agent-build-shell";
  focus?: boolean;
  origin?: TerminalFocusOrigin;
  initialPrompt?: string;
};

export type TerminalIntentSubject =
  | {
      kind: "worktree";
      projectId?: ProjectId;
      worktreeId: WorktreeId;
    }
  | {
      kind: "session";
      sessionId: SessionId;
      projectId?: ProjectId;
      worktreeId?: WorktreeId;
    };

export type TerminalFocusIntent = {
  type: "terminal.focus";
  commandId: CommandId;
  terminalProvider: ProviderId;
  subject: TerminalIntentSubject;
  origin?: TerminalFocusOrigin;
};

export type TerminalCloseIntent = {
  type: "terminal.close";
  commandId: CommandId;
  terminalProvider: ProviderId;
  subject: TerminalIntentSubject;
  force?: boolean;
};
```

Contract rules:

```text
schemas are strict
intent payloads include product references, not provider topology
terminalProvider is required after observer has selected or inferred the provider
focus origin remains provider-neutral and can carry popup/client origin metadata
close force remains product policy metadata
```

Rejected fields:

```text
targetId
paneId
windowId
tabId
sessionName
tmux option names
Ghostty window or tab ids
raw providerData
```

### 5.2 Intent Receipt

Proposed first-pass shape:

```ts
export type TerminalIntentReceipt =
  | {
      commandId: CommandId;
      terminalProvider: ProviderId;
      status: "accepted";
      acceptedAt: string;
    }
  | {
      commandId: CommandId;
      terminalProvider: ProviderId;
      status: "rejected";
      rejectedAt: string;
      error: SafeError;
    };
```

Receipt meaning:

```text
accepted:
  the terminal intent runner completed the synchronous acceptance work for this intent
  observer may mark the command succeeded after its own post-receipt work
  accepted does not prove the agent process is healthy, idle, or still running

rejected:
  the runner could not accept the intent because validation, provider state,
  terminal mechanics, harness launch planning, launch confirmation, or policy failed
  observer should fail the command with the receipt SafeError
```

For the first in-process tmux path, `session.ensureAgentWorkspace` should return `accepted` only after:

```text
harness provider is found
terminal workspace is opened or reused
terminal identity binding is converted to a normalized target observation for launch planning
harness buildLaunch succeeds
terminal launchProcess succeeds and reports started
focus is attempted when requested
```

Focus during `session.ensureAgentWorkspace` should preserve the current UX: if launch succeeds but optional focus fails, the intent may still be accepted and the focus failure should be logged or diagnosed. Direct `terminal.focus` commands should reject when focus fails.

PR 1 implementation note:

```text
terminal intent submission and receipts are observer JSONL log evidence, not durable WOSM events
logs should include commandId, intentType, terminalProvider, trace/span ids when present,
  and product identifiers such as projectId, worktreeId, sessionId, and harnessProvider
rejected receipts should log the SafeError code/provider while preserving the SafeError for command failure
do not add terminal.intent.* event schemas or protocol-visible intent history in PR 1
```

### 5.3 Submit Context

Do not put trace, timeout, or cancellation data in the public intent schema. Those are runtime execution context, not payload data.

Observer runner interface:

```ts
export type TerminalIntentSubmitContext = {
  signal?: AbortSignal;
  trace?: RuntimeTraceContext;
  commandTimeoutMs?: number;
};

export interface TerminalIntentRunner {
  submitIntent(
    intent: TerminalIntent,
    context?: TerminalIntentSubmitContext,
  ): Promise<TerminalIntentReceipt>;
}
```

`RuntimeTraceContext` can come from `@wosm/runtime`, matching existing provider mutation boundaries.

## 6. Runner Responsibilities

### 6.1 `session.ensureAgentWorkspace`

The runner should:

```text
validate intent.terminalProvider matches the configured terminal provider
resolve the requested harness provider from the injected harness map
call terminal.openWorkspace(...)
convert the returned TerminalIdentityBinding into TerminalTargetObservation
call harness.buildLaunch(...)
call terminal.launchProcess(...)
attempt focus only when intent.focus is true
return an accepted receipt on launch success
return a rejected receipt with SafeError on validation/open/build/launch failure
ensure duplicate commandId submissions do not spawn duplicate launches in one observer process
```

The runner must not:

```text
create worktrees
seed observer session title metadata
publish session.created
mutate observer persistence directly
inspect observer SQLite
scrape tmux providerData for normal behavior
construct Codex/OpenCode/Cursor/Pi command lines itself
```

Harness command construction remains harness-owned:

```text
CodexHarnessProvider builds Codex CLI args/env
OpenCodeHarnessProvider builds OpenCode CLI args/env
CursorHarnessProvider builds Cursor CLI args/env
PiHarnessProvider builds Pi CLI args/env
ScriptedAgentHarnessProvider builds scripted test launch args/env
```

### 6.2 `terminal.focus`

The runner should resolve the subject to a terminal target using normalized observations:

```text
terminal.listTargets()
prefer open targets with matching sessionId for session subjects
prefer open main-agent or workspace targets with matching worktreeId for worktree subjects
prefer targets whose harnessBinding.role is "main-agent" for agent focus
avoid providerData fallback in the generic runner
call terminal.focusTarget(...)
return accepted on success
return rejected on missing target or focus failure
```

If tmux later needs stronger fallback logic, keep it behind a terminal-provider-owned helper. The generic runner should still call a terminal abstraction rather than parse tmux fields itself.

### 6.3 `terminal.close`

The runner should:

```text
resolve the subject to closeable target(s) using normalized observations
prefer session-specific targets for session subjects
prefer primary agent targets before workspace shell targets for worktree subjects
call terminal.closeTarget(...)
return accepted when close succeeds or when idempotent missing/closed semantics apply
return rejected when policy, target resolution, or close mechanics fail
```

Observer command handlers should still validate product-level force policy before submitting a close intent. The runner owns concrete target selection and close mechanics.

## 7. Observer Command Handler Changes

### 7.1 `session.create`

Observer should keep:

```text
validate project, terminal provider, harness provider, branch/base/source, command context
create the worktree through the worktree provider
allocate sessionId
seed session title before terminal intent submission
submit one session.ensureAgentWorkspace intent
delete title seed and remove created worktree if the intent is rejected
reconcile after accepted receipt
publish session.created from reconciled snapshot
record command lifecycle, trace, SafeError, and diagnostics
```

Observer should stop:

```text
calling terminal.openWorkspace
calling harness.buildLaunch for terminal execution
calling terminal.launchProcess
calling terminal.focusTarget
converting terminal identity bindings for launch planning
closing provider targets after partial terminal launch failure
tracking openedTargetId
```

Rollback rule:

```text
before accepted receipt:
  observer may remove the created worktree and delete the title seed

after accepted receipt:
  observer should not close provider targets directly
  explicit user cleanup and reconcile handle later terminal/harness state
```

### 7.2 `session.startAgent`

Observer should keep:

```text
resolve project and worktree from snapshot or worktree provider
enforce "no current primary agent"
choose harness provider from payload, remembered harness, or project default
allocate sessionId
seed session title before terminal intent submission
submit one session.ensureAgentWorkspace intent
delete title seed if the intent is rejected
reconcile after accepted receipt
publish session.created from reconciled snapshot
```

Observer should stop the same direct terminal and harness workflow calls listed for `session.create`.

### 7.3 `terminal.focus`

Observer should:

```text
validate payload shape
infer or validate terminal provider
convert command payload to TerminalIntentSubject
submit terminal.focus intent
mark command succeeded on accepted receipt
fail command on rejected receipt
```

Observer should not resolve a concrete target id from snapshot rows or sessions.

### 7.4 `terminal.close`, `session.close`, And Cleanup Paths

Observer should:

```text
validate product-level force policy
stop harness provider runs when mode requires harness stop
submit terminal.close intent when mode requires terminal close
reconcile after accepted close intent
publish removed-session events from reconciled state when applicable
```

Observer should stop:

```text
calling terminalTargetIdForSession(...)
calling terminalTargetIdForRow(...)
calling terminal.closeTarget(...) in normal command handlers
using primaryAgentTargetId/workspaceTargetId for normal cleanup
```

Target-level close may remain later only under an explicit debug command namespace.

### 7.5 Command Queue Scoping

Normal terminal command scoping should move away from target ids:

```text
terminal.focus with session subject -> session:<sessionId>
terminal.focus with worktree subject -> worktree:<worktreeId>
terminal.close with session subject -> session:<sessionId>
terminal.close with worktree subject -> worktree:<worktreeId>
session.ensureAgentWorkspace -> worktree:<worktreeId> or session:<sessionId> depending caller
session.create -> project:<projectId>
```

Once normal commands no longer accept `targetId`, remove `terminal-target:${targetId}` from normal command queue scoping.

## 8. TUI And CLI Changes

### 8.1 TUI

Update command builders so they express product subjects:

```text
buildFocusCommand(row)
  prefer row.agent.sessionId when present
  otherwise use row.id as worktreeId
  never read row.terminal.primaryAgentTargetId
  never read row.terminal.workspaceTargetId

buildTerminalCloseCommand(row)
  prefer row.agent.sessionId when present
  otherwise use row.id as worktreeId
  include force when required
  never read row.terminal.*TargetId
```

Preserve popup-origin focus metadata:

```text
terminal.focus.origin.provider
terminal.focus.origin.clientId
```

### 8.2 CLI And Notify Paths

Existing notify/click-to-focus paths should keep session/worktree-oriented copy and emit normal `terminal.focus` commands by session or worktree reference. They should not emit target ids after the product command schema migration.

### 8.3 Public Command Schema Migration

Do this after observer and TUI no longer depend on target ids:

```text
remove targetId from terminal.focus payload schema
remove targetId from terminal.close payload schema
update schema tests to reject targetId
if needed, add explicit debug terminal target commands later
```

Do not remove target ids from terminal observations or provider internals in the P0 slice. That belongs to the P1 terminal leakage plan.

## 9. Idempotency

First slice:

```text
DefaultTerminalIntentRunner keeps an in-memory Map<string, Promise<TerminalIntentReceipt>>
key is commandId plus intent type
duplicate in-process submissions return the same promise
session.ensureAgentWorkspace duplicate submissions do not launch twice
focus duplicate submissions are allowed and converge on focus success/failure
close duplicate submissions are allowed and converge on closed/missing state
```

Limit:

```text
this does not survive observer restart
durable idempotency can be added later through provider-owned markers,
for example tmux @wosm.intent_command_id options
```

The first slice should call this "in-process idempotency", not durable idempotency.

## 10. Failure Modes And Semantics

### 10.1 Rejected Intent Cases

`session.ensureAgentWorkspace` should reject when:

```text
terminalProvider does not match configured runner terminal
harness provider is unavailable or missing
terminal.openWorkspace fails
harness.buildLaunch fails
terminal.launchProcess is unsupported
terminal.launchProcess fails
terminal.launchProcess returns started: false
command is aborted before acceptance
provider call times out before acceptance
```

`terminal.focus` should reject when:

```text
subject cannot be resolved to an open focusable target
terminal.focusTarget fails
command is aborted
provider call times out
```

`terminal.close` should reject when:

```text
subject cannot be resolved and policy says missing is not success
terminal.closeTarget fails
command is aborted
provider call times out
```

### 10.2 Error Ownership

Use `SafeError` tags that match the failing owner:

```text
TerminalProviderError:
  open workspace, launch process, focus target, close target, list targets

HarnessProviderError:
  missing harness, launch plan construction, unsupported harness launch options

CommandValidationError:
  product reference invalid, policy violation, mismatched project/worktree/session

TimeoutError:
  provider call exceeded bounded runtime
```

### 10.3 Command Success Meaning

For terminal-owned work:

```text
command.succeeded means observer completed observer-owned work and received
an accepted terminal intent receipt
```

It does not prove:

```text
the agent is healthy
the process is still running
the terminal is currently focused
the provider target is not stale
```

Running, exited, stale, missing, and attention truth comes from reconcile over terminal and harness observations.

## 11. Three-PR Maximum Rollout Plan

The full terminal boundary work should ship in no more than three reviewable PRs.

PR 1 and PR 2 are the P0 architecture refactor. PR 3 is the remaining P1 terminal leakage cleanup. If PR 1 or PR 2 already removes a leakage item, PR 3 should skip that item rather than rework it.

This keeps the rollout bounded:

```text
PR 1:
  establish the runner boundary and migrate session launch

PR 2:
  migrate focus/close, TUI command builders, cleanup close flows, and normal command schemas

PR 3:
  remove remaining terminal topology leakage from snapshots, persistence, tests, and provider composition
```

### PR 1: Intent Runner And Session Launch Migration

Goal:

```text
create the terminal intent data contracts
add the observer-owned TerminalIntentRunner capability
migrate session.create and session.startAgent to submit session.ensureAgentWorkspace
keep focus/close command payloads and targetId compatibility unchanged for now
```

Scope:

```text
add packages/contracts/src/terminalIntents.ts
add strict intent and receipt schema tests
reject topology fields such as targetId, paneId, windowId, tabId, and sessionName
add apps/observer/src/providers/terminalIntentRunner.ts
define TerminalIntentRunner and TerminalIntentSubmitContext in observer
implement DefaultTerminalIntentRunner session.ensureAgentWorkspace
extend ProviderRegistry with terminalIntentRunner
wire createTerminalIntentRunner in apps/observer/src/providers/factory.ts
move terminalTargetObservationFromBinding to a contract/shared helper if needed
update fake/testing helpers to expose runner behavior
change observer session.create to submit one session.ensureAgentWorkspace intent
change observer session.startAgent to submit one session.ensureAgentWorkspace intent
preserve title seed and worktree rollback when the intent is rejected
remove observer-owned openedTargetId cleanup from session create/start after accepted intent
```

Out of scope for PR 1:

```text
terminal.focus migration
terminal.close migration
TUI focus/close command builder changes
removing targetId from normal terminal.focus/terminal.close command schemas
snapshot topology-field cleanup
providerData persistence cleanup
new terminal shared package
Ghostty provider work
```

PR 1 acceptance:

```text
contracts export TerminalIntent and TerminalIntentReceipt schemas/types
TerminalIntentRunner lives in apps/observer, not packages/contracts
ProviderRegistry constructs terminal, harnesses, and runner independently
session.create handler does not call terminal.openWorkspace
session.create handler does not call harness.buildLaunch
session.create handler does not call terminal.launchProcess
session.startAgent handler does not call terminal open/build/launch mechanics
DefaultTerminalIntentRunner does call terminal and harness providers in the expected order
duplicate commandId for session.ensureAgentWorkspace does not launch twice in-process
terminal intent submission and accepted/rejected receipts are visible in observer logs
tmux session create/start behavior remains user-visible equivalent
```

PR 1 implementation notes:

```text
TerminalFocusIntent and TerminalCloseIntent schemas may exist in contracts, but the runner rejects them
  until PR 2 migrates focus and close behavior
session.create and session.startAgent may keep existing terminal/harness id validation before intent
  submission while the runner also validates provider availability at the orchestration boundary
raw top-level providerData on terminal intents is rejected; nested providerData already owned by
  existing observation schemas remains valid when an intent carries a WorktreeObservation
direct ProviderRegistry construction may install a default runner for tests and hand-built registries,
  while createProviderRegistry still constructs and injects the composition-root runner
```

PR 1 verification:

```bash
pnpm test:contracts
pnpm --filter @wosm/observer test
pnpm --filter @wosm/tmux test
pnpm --filter @wosm/testing test
pnpm test:all
```

Manual PR 1 smoke:

```text
create a new session in tmux
start an agent on an existing no-agent worktree
verify rows reconcile to an agent state
verify debug bundles include command lifecycle plus observer logs with terminal intent submission
verify logs show submitted and accepted/rejected terminal intent records rather than command handlers
  directly sequencing open/build/launch
```

### PR 2: Focus, Close, TUI, And Command Surface Cleanup

Goal:

```text
migrate focus and close to terminal intents
make normal UI/CLI commands session/worktree-oriented
remove targetId from normal terminal.focus and terminal.close schemas
leave provider target ids behind provider, diagnostics, or future debug-only boundaries
```

Scope:

```text
implement DefaultTerminalIntentRunner terminal.focus
implement DefaultTerminalIntentRunner terminal.close
resolve focus/close subjects using normalized TerminalTargetObservation fields
avoid providerData fallback in the generic runner
add narrow tmux-specific target resolution only if normalized observations are insufficient
change observer terminal.focus to submit terminal.focus intent
change observer terminal.close to submit terminal.close intent
change session.close terminal/all paths to submit terminal.close intent
change cleanup terminal paths to submit terminal.close intent
update command queue scoping away from terminal-target:<targetId>
change TUI focus builder to emit sessionId/worktreeId, not targetId
change TUI close builder to emit sessionId/worktreeId, not targetId
preserve terminal.focus.origin for popup-origin focus
update notify/click-to-focus paths if they emit target ids
remove targetId from normal terminal.focus payload schema
remove targetId from normal terminal.close payload schema
update schema, observer, TUI, CLI, and protocol tests
```

Out of scope for PR 2:

```text
removing target ids from terminal observations
removing topology-shaped snapshot attachment fields
removing all providerData persistence
adding a debug-target command namespace unless needed to preserve an existing workflow
creating integrations/terminal/shared
```

Implementation notes after PR 2:

```text
apps/observer/src/commands/terminalIntents.ts is the command-side helper for
payload-to-subject conversion, terminal intent submission, rejected-receipt
throwing, and provider-neutral closeable attachment checks.

observer cleanup no longer keeps normal target-id resolution helpers; concrete
focus/close target choice lives in DefaultTerminalIntentRunner.

closeTerminalTarget remains a low-level provider-mechanics helper, but normal
terminal.close, session.close, session.remove, and worktree.remove paths should
submit terminal.close intents instead of calling it directly.

target ids intentionally remain in terminal observations, snapshot attachment
fields, provider APIs, diagnostics, and provider-mechanics tests until the PR 3
leakage cleanup.
```

PR 2 acceptance:

```text
terminal.focus handler does not call terminal.focusTarget directly
terminal.close handler does not call terminal.closeTarget directly
session.close terminal/all paths do not resolve provider target ids in observer
normal terminal.focus schema rejects targetId
normal terminal.close schema rejects targetId
TUI focus/close builders never read row.terminal.*TargetId
command queue scoping uses session/worktree/project references for normal terminal commands
generic focus/close resolution uses normalized observation fields, not providerData
tmux focus/close behavior remains user-visible equivalent
popup-origin focus still reaches the expected tmux target
```

PR 2 verification:

```bash
pnpm test:contracts
pnpm --filter @wosm/observer test
pnpm --filter @wosm/tui test
pnpm --filter @wosm/tmux test
pnpm test:all
```

Manual PR 2 smoke:

```text
focus a running session from the TUI
focus from popup-origin flow
close a session terminal
close all for a running session with force when required
verify rows reconcile to closed/exited/missing state without observer target-resolution errors
verify normal command payloads no longer contain targetId
```

### PR 3: Remaining Terminal Leakage Cleanup

Implementation note as of 2026-06-05:

```text
PR 3 implements the remaining leakage cleanup after PR 2.
Normal snapshot row/session terminal data now uses provider-neutral attachment fields.
WOSM_SCHEMA_VERSION is bumped to 0.4.0 because the normal snapshot wire shape changed.
Terminal providerData is stripped from observer-owned terminal target and terminal provider-observation persistence, including hook-ingested terminal observations.
Row-level diagnostic evidence no longer derives targetId or terminal-target questions from snapshot rows; targetId evidence must come from explicit errors, logs, provider diagnostics, or other deliberate diagnostic sources.
Concrete provider construction moved from apps/observer into CLI bootstrap code.
apps/cli/dist/observerMain.js is now the production observer bootstrap for repo callers and provider-hook autostart.
apps/observer/dist/runtime/main.js is no longer a standalone production bootstrap.
The debug terminal-target command namespace remains deferred.
```

Goal:

```text
finish the boundary cleanup after normal commands no longer rely on target ids
remove provider-topology pressure from normal snapshot and observer-facing data
keep provider target identity behind provider, diagnostics, or explicit debug boundaries
```

Relationship to `docs/planning/completed/terminal_leakage_p1_fix.md`:

```text
the P1 leakage doc remains accurate as the detailed backlog of leakage concerns
it now marks the PR 2 overlap and PR 3 implementation status
items completed by PR 2 stay out of the remaining PR 3 scope
especially targetId removal from normal focus/close commands and session cleanup close flows
```

Scope:

```text
refresh terminal_leakage_p1_fix.md against the merged PR 1 and PR 2 code
replace topology-shaped normal snapshot fields with provider-neutral attachment state
remove workspaceTargetId and primaryAgentTargetId from normal TUI-facing row/session surfaces
remove sessionName/windowId/attached-style fields from normal snapshot surfaces where they encode tmux topology
constrain terminal providerData persistence and debug exposure
move provider target ids into diagnostics/debug evidence only where still needed
purge provider-shaped terminal ids from observer tests where the behavior is not target-specific
decide whether concrete provider construction in apps/observer remains acceptable composition-root wiring
add or explicitly defer a debug terminal-target command namespace if users still need target-level operations
```

Out of scope for PR 3:

```text
changing the runner boundary established in PR 1 and PR 2
building Ghostty
creating integrations/terminal/shared without a second terminal provider proving real duplication
removing provider target ids from terminal provider internals
removing diagnostic evidence needed for debug trace and debug bundle flows
```

PR 3 acceptance:

```text
normal snapshot surfaces describe terminal attachment state, not tmux-like topology
TUI renders the same user-facing state without provider target ids
observer tests use opaque provider-neutral target ids unless testing provider-specific behavior
terminal providerData is not exposed as normal snapshot data
debug bundles and diagnostics still have enough evidence to diagnose terminal target issues
no normal command path reintroduces targetId
the P1 leakage doc is updated to reflect completed, remaining, and deferred items
```

PR 3 verification:

```bash
pnpm test:contracts
pnpm --filter @wosm/observer test
pnpm --filter @wosm/tui test
pnpm test:all
```

Manual PR 3 smoke:

```text
open the TUI and verify rows still show terminal/agent state clearly
focus and close a session using normal product commands
run a debug trace or debug bundle for a recent terminal command
verify diagnostic evidence still identifies the relevant provider/command/session/worktree
verify normal snapshot JSON no longer exposes topology-shaped terminal fields
```

## 12. Test Plan

### 12.1 Contracts

```text
TerminalIntentSchema accepts valid ensure/focus/close intents
TerminalIntentSchema rejects targetId, paneId, windowId, tabId, sessionName
TerminalIntentReceiptSchema accepts accepted and rejected receipts
TerminalIntentReceiptSchema preserves SafeError for rejected intents
normal terminal.focus schema eventually rejects targetId
normal terminal.close schema eventually rejects targetId
```

### 12.2 Runner

```text
session.ensureAgentWorkspace opens/reuses workspace through terminal provider
session.ensureAgentWorkspace builds launch through harness provider
session.ensureAgentWorkspace launches through terminal provider
session.ensureAgentWorkspace passes terminal target observation to harness buildLaunch
session.ensureAgentWorkspace focuses only when focus is true
focus failure during ensure logs/diagnoses but does not fail launch success
missing harness returns rejected HarnessProviderError
open failure returns rejected TerminalProviderError
buildLaunch failure returns rejected HarnessProviderError
launch failure returns rejected TerminalProviderError
duplicate commandId does not respawn or relaunch
terminal.focus resolves by sessionId
terminal.focus resolves by worktreeId
terminal.focus rejects missing target
terminal.close resolves by sessionId
terminal.close resolves by worktreeId
terminal.close rejects or accepts missing targets according to explicit policy
runner does not inspect providerData in generic resolution tests
```

### 12.3 Observer

```text
session.create handler does not call terminal.openWorkspace
session.create handler does not call harness.buildLaunch
session.create handler does not call terminal.launchProcess
session.create removes created worktree when intent is rejected
session.create deletes title seed when intent is rejected
session.create does not close provider targets after accepted receipt
session.startAgent handler does not call terminal open/build/launch mechanics
session.startAgent deletes title seed when intent is rejected
terminal.focus handler does not call focusTarget directly
terminal.close handler does not call closeTarget directly
session.close terminal/all modes submit terminal.close intents
command records retain trace ids, command ids, succeeded/failed state, SafeError payloads
reconcile still publishes rows and sessions from normalized observations
```

### 12.4 Tmux

Keep low-level tmux provider tests green:

```text
openWorkspace identity binding
launchProcess command/env execution
focusTarget stale target errors
closeTarget mechanics
listTargets normalized observations
popup focus origin behavior where applicable
```

Add tmux integration coverage only where tmux-specific resolution fallback is introduced.

### 12.5 TUI

```text
focus command builder emits sessionId/worktreeId, not targetId
close command builder emits sessionId/worktreeId, not targetId
primary row action starts agent when no agent exists
primary row action focuses session/worktree when agent exists
popup-origin focus still passes terminal.focus.origin
cleanup flow still includes force when required
```

## 13. Verification Commands

Focused verification:

```bash
pnpm test:contracts
pnpm --filter @wosm/observer test
pnpm --filter @wosm/tmux test
pnpm --filter @wosm/testing test
```

Full deterministic gate:

```bash
pnpm test:all
```

Manual tmux smoke:

```text
1. Start WOSM TUI from a tmux client.
2. Create a new session.
3. Verify the row reconciles with an agent state.
4. Start an agent on an existing no-agent worktree.
5. Focus the running row from the TUI.
6. Trigger popup-origin focus if running in popup mode.
7. Close the terminal/session.
8. Verify rows reconcile to closed/exited/missing state without observer errors.
```

## 14. UX Implication

The intended user-visible behavior is unchanged for tmux:

```text
create session starts an agent in the expected tmux workspace
start agent on an existing worktree still works
row focus still focuses the right terminal target
close still closes the relevant terminal/session
popup-origin focus still returns attention to the right client/popup flow
```

The important UX improvement is architectural: normal UI actions become session/worktree-oriented instead of target-id-oriented. This makes future terminal providers able to present the same product actions with different window, tab, or pane layouts.

Manual verification should confirm no visible regression in the tmux TUI flow while debug traces show command handlers submitting terminal intents rather than directly sequencing terminal mechanics.

## 15. Open Questions

These should be answered during implementation, not by blocking the plan:

```text
should close missing target be accepted as idempotent success or rejected as stale UI?
does terminal.focus for a worktree prefer main-agent role or workspace shell when both exist?
does any notify/click-to-focus path still need temporary targetId compatibility?
```

The default choices for the first implementation:

```text
missing focus target rejects
missing close target rejects unless existing cleanup behavior clearly treats it as no-op
worktree focus prefers main-agent role, then workspace target
ensure focus failure is best-effort and non-fatal
move generic binding-to-observation conversion into packages/contracts
focus failure during session.ensureAgentWorkspace is log-only in PR 1, not a diagnostic event
terminalTargetObservationFromBinding lives in packages/contracts/src/terminalTargets.ts
keep temporary targetId command compatibility only until TUI/observer no longer emit it
```
