# Terminal Leakage P1 Fix Plan

**Status:** Completed cleanup record with PR 2/PR 3 implementation notes (moved to completed 2026-06-11)
**Date:** 2026-05-24
**Severity:** P1 leakage
**Applies to:** contracts, snapshots, TUI commands, observer persistence, provider wiring
**Source baseline:** `docs/planning/historical/wosm_rebuild_tdd_final_v1.md`, and `docs/planning/completed/terminal_ownership_p0_blocker_fix.md`

This document plans cleanup for confirmed terminal leakage that is real but not independently blocking once the P0 terminal ownership fix is complete.

P1 work should follow the P0 blocker fix unless a slice is clearly contract-only and does not depend on the new terminal intent boundary.

Coordination note as of 2026-06-04: the P0 rollout in `terminal_ownership_p0_blocker_fix.md` now uses a maximum three-PR plan. PR 2 removed `targetId` from normal `terminal.focus` / `terminal.close` commands and moved session cleanup close flows to product intents. The PR 2 overlap and PR 3 implementation status are marked below so future work does not reintroduce completed command-surface cleanup.

Implementation note as of 2026-06-05: PR 2 completed the normal focus/close and cleanup command-surface migration. The PR 3 implementation removes topology-shaped terminal fields from normal snapshot row/session terminal attachments, strips terminal `providerData` from observer-owned terminal target and provider-observation persistence, moves concrete provider construction into the CLI bootstrap, and leaves target ids behind provider, terminal-intent, diagnostic, and provider-specific test boundaries.

Compatibility note as of 2026-06-05: the normal snapshot wire shape changed, so `WOSM_SCHEMA_VERSION` moved from `0.3.0` to `0.4.0`. Observability artifacts that embed snapshots, including diagnostic snapshots and doctor reports, carry the new terminal attachment shape. Diagnostic evidence index schema stays stable, but row-derived terminal `targetId` evidence and the row terminal-target question are intentionally no longer produced from snapshot rows.

## 0. Dependency And Conflict Rule

This P1 plan assumes `docs/planning/completed/terminal_ownership_p0_blocker_fix.md` has established a terminal intent boundary. Where this document or the P0 document conflicts with older command-path examples in the baseline TDD, the P0/P1 addenda are authoritative for terminal ownership.

P1 should not reintroduce observer-owned terminal mechanics while removing leaked fields. Any implementation slice that needs target ids to preserve behavior should keep them behind the provider, terminal intent runner, diagnostic, or debug boundary rather than adding them back to normal TUI/protocol surfaces.

## 1. Confirmed Leakage

### P1.1 Terminal Target Identity Crosses UI And Protocol Boundaries

PR 2 status:

```text
completed for normal terminal.focus and terminal.close command payloads
normal product commands now use sessionId or worktreeId instead of targetId
terminal target ids remain in provider APIs, terminal intent runner internals, diagnostics, and provider-specific evidence
```

Original evidence before PR 2/PR 3:

```text
packages/contracts/src/commands.ts
  terminal.focus accepts targetId
  terminal.close accepts targetId

apps/tui/src/actions.ts
  focus and close prefer row.terminal.primaryAgentTargetId or workspaceTargetId
```

Why it matters:

```text
TerminalTargetId is typed as provider-neutral, but its value is provider-owned topology.
For tmux it can encode session/window/pane identity.
For Ghostty it could encode window/tab identity.
TUI and protocol should express product intent, not provider target mechanics.
```

### P1.2 Snapshot Contracts Contain Terminal-Topology-Shaped Fields

PR 3 status:

```text
completed for normal snapshot row/session terminal attachments
```

Original evidence before PR 2/PR 3:

```text
packages/contracts/src/snapshot.ts
  WorktreeTerminalSchema has sessionName, windowId, attached
  SessionViewSchema.terminal repeats similar fields
```

Why it matters:

```text
These fields are not direct tmux reads inside observer, but they encode terminal topology in shared contracts.
They create pressure for every terminal provider to map its model into session/window/attached concepts.
```

### P1.3 Observer Persists Raw Terminal providerData

PR 3 status:

```text
completed for terminal_targets.provider_data_json writes and hydration
completed for terminal provider_observations.payload_json writes and hydration
completed for hook-ingested terminal observations
legacy columns remain in place and legacy terminal providerData is ignored/sanitized on read
```

Original evidence before PR 2/PR 3:

```text
apps/observer/src/persistence/correlations.ts
  terminal_targets.provider_data_json stores target.providerData

apps/observer/src/persistence/rows.ts
  provider_data_json is read back into terminal providerData
```

Why it matters:

```text
Observer does not parse this payload, but provider-specific terminal internals still enter observer state.
Debug bundles, persistence inspection, and future code can accidentally depend on it.
```

### P1.4 Observer App Constructs Concrete Terminal Integrations

PR 3 status:

```text
completed by moving real provider construction to apps/cli/src/observerProviders.ts
apps/cli/src/observerMain.ts is now the production observer bootstrap
apps/observer/dist/runtime/main.js is no longer a standalone production bootstrap
repo observer callers and provider-hook autostart now target apps/cli/dist/observerMain.js
```

Original evidence before PR 2/PR 3:

```text
apps/observer/src/providers/factory.ts
  imports TmuxProvider from @wosm/tmux
  constructs TmuxProvider directly from observer app wiring
```

Why it matters:

```text
This is composition-root leakage, not observer core parsing tmux.
It is acceptable as a temporary bootstrap shape, but it keeps concrete integration knowledge inside apps/observer.
```

### P1.5 Observer Tests Use Provider-Shaped Terminal IDs

PR 3 status:

```text
completed for normal snapshot, TUI, diagnostics, and observer coverage
provider-specific tests may still use provider-shaped ids when the test is explicitly about provider mechanics or target correlation
```

Original evidence before PR 2/PR 3:

```text
apps/observer/test/unit/terminal-commands.test.ts
apps/observer/test/integration/reconcile-codex-harness.test.ts
apps/observer/test/unit/graph.test.ts
```

Why it matters:

```text
Tests that use tmux-shaped IDs train observer behavior around provider topology.
Observer tests should use opaque target ids with no parseable provider semantics.
```

### P1.6 Session Cleanup Resolves Terminal Targets Through Observer

PR 2 status:

```text
completed for normal cleanup and close flows by submitting product terminal intents
the terminal intent runner still resolves concrete provider targets behind the observer/runtime boundary
```

Original evidence before PR 2/PR 3:

```text
apps/observer/src/commands/cleanup/resolve.ts
  resolves targetId from SessionView.terminal and WorktreeRow.terminal

apps/observer/src/commands/cleanup/operations.ts
  session.close with mode terminal/all calls terminal.closeTarget(...)
  worktree cleanup can close terminal targets by row-derived targetId
```

Why it matters:

```text
Removing targetId from terminal.focus and terminal.close is not enough.
Normal session cleanup still teaches observer to find provider-owned terminal targets.
If snapshot topology fields are removed before this path changes, cleanup behavior will break.
```

## 2. Boundary Target

After P1 cleanup, shared observer-facing data should describe product state:

```text
worktree exists
agent state
session state
terminal attachment state
provider id
capabilities
confidence/reason/observedAt
cleanup eligibility
opaque provider reference only where strictly required for diagnostics
```

Shared observer-facing data should not describe provider topology:

```text
tmux session names
tmux window ids
tmux pane ids
Ghostty window ids
Ghostty tab ids
attached flags that mean tmux-client attachment
provider-specific launch endpoints
raw provider payloads
```

## 3. Implementation Sequence

### P1.1 Remove targetId From Human Command Surfaces

Update command contracts so TUI/CLI focus and close use product references.

This applies to normal `WosmCommand` payloads and normal TUI/CLI action builders. Debug commands may still address provider targets, but only in an explicit debug namespace with provider/debug wording.

Target command payloads:

```ts
export type TerminalFocusPayload = {
  projectId?: ProjectId;
  worktreeId?: WorktreeId;
  sessionId?: SessionId;
  origin?: TerminalFocusOrigin;
};

export type TerminalClosePayload = {
  projectId?: ProjectId;
  worktreeId?: WorktreeId;
  sessionId?: SessionId;
  force?: boolean;
};
```

Acceptance:

```text
terminal.focus no longer accepts targetId in public command schema
terminal.close no longer accepts targetId in public command schema
TUI focus command never reads row.terminal.*TargetId
TUI close command never reads row.terminal.*TargetId
observer command tests validate focus/close by worktree/session only
command queue scoping uses session/worktree/project references, not terminal target ids
```

Compatibility note:

```text
If a debug-only targetId path is still needed, keep it out of normal WosmCommand.
Use a debug command namespace with explicit provider/debug wording.
```

### P1.2 Replace Topology Fields In Snapshot Contracts

Replace topology-shaped fields with provider-neutral attachment state.

Possible shape:

```ts
export const TerminalAttachmentSchema = z
  .object({
    provider: ProviderIdSchema,
    state: TerminalStateSchema,
    focusable: z.boolean().optional(),
    closeable: z.boolean().optional(),
    hasWorkspace: z.boolean().optional(),
    hasPrimaryAgentEndpoint: z.boolean().optional(),
    confidence: ConfidenceSchema.optional(),
    reason: nonEmptyStringSchema.optional(),
    observedAt: TimestampSchema.optional(),
  })
  .strict();
```

Remove from shared snapshot contracts:

```text
workspaceTargetId
primaryAgentTargetId
sessionName
windowId
agentEndpointId
attached
```

Acceptance:

```text
WorktreeRow.terminal no longer exposes provider target ids
SessionView.terminal no longer exposes sessionName/windowId/attached
TUI renders the same user-facing state without provider topology fields
observer graph maps TerminalTargetObservation to provider-neutral attachment state
snapshot schema tests reject topology fields
debug bundle evidence that needs provider targets uses explicit diagnostic evidence records, not snapshot row/session fields
```

### P1.3 Constrain Terminal providerData Persistence

Move provider-private terminal data out of observer's general correlation tables.

Allowed observer persistence:

```text
target id as opaque correlation key, if still needed internally
provider id
project id
worktree id
session id
harness run id
terminal state
last seen time
confidence/reason if useful for diagnostics
```

Disallowed observer persistence:

```text
raw terminal providerData JSON in terminal_targets
tmux pane/window/session payloads in observer-owned tables
Ghostty window/tab payloads in observer-owned tables
launch endpoint payloads in observer-owned tables
```

Provider-private state should live behind the provider boundary:

```text
integration-owned state directory
integration-owned schema
integration-owned debug redaction
debug bundle includes provider-private evidence only through provider diagnostics/export hooks
```

Migration approach:

```text
new writes stop storing terminal providerData in observer-owned terminal_targets
row hydration ignores terminal provider_data_json even if old rows contain it
legacy provider_data_json columns may remain temporarily if removing them is not worth a migration in this slice
debug bundle redacts or omits legacy terminal provider_data_json and does not depend on it
provider diagnostics/export hooks become the supported path for provider-private evidence
```

Acceptance:

```text
terminal_targets no longer stores raw provider_data_json for terminal observations
observer row hydration does not restore terminal providerData
debug bundle still has enough provider evidence through explicit provider diagnostics
tests prove malformed providerData cannot affect observer terminal correlation
legacy persisted terminal provider_data_json cannot affect current snapshot shape
```

### P1.4 Move Concrete Provider Construction Out Of apps/observer

Move concrete integration imports to a bootstrap or provider-registry composition package.

Current issue:

```text
apps/observer imports @wosm/tmux and @wosm/worktrunk directly in provider factory
```

Target:

```text
apps/observer accepts a ProviderRegistry or ProviderRegistryFactory
CLI/bootstrap composes real integrations
observer package tests compose fake providers without integration imports
provider diagnostics flow through contracts
```

Acceptance:

```text
apps/observer production source does not import @wosm/tmux
apps/observer production source does not import @wosm/worktrunk for provider construction
apps/observer can run entirely with injected fake providers
CLI or bootstrap code owns real provider construction
existing real-provider smoke paths still work
```

### P1.5 Purge Provider-Shaped IDs From Observer Tests

Replace tmux-shaped test IDs with opaque ids.

Use examples like:

```text
term_alpha
term_existing_agent
term_focusable_workspace
```

Avoid examples like:

```text
tmux:wosm:@1:%2
@1
%2
```

Acceptance:

```text
observer unit/integration tests do not require parseable tmux-shaped target ids
tmux-shaped id parsing remains tested only in integrations/terminal/tmux
graph/focus/close tests assert product behavior, not provider topology
```

### P1.6 Move Session Cleanup And Close Flows To Product Intents

Update `session.close` terminal paths, `close-all` paths, and worktree cleanup terminal-closing paths so observer no longer resolves provider terminal target ids.

Target behavior:

```text
session.close mode terminal:
  observer validates session and force policy
  observer submits terminal close intent by session/worktree reference

session.close mode all:
  observer stops harness through harness provider when supported
  observer submits terminal close intent by session/worktree reference
  observer reconciles after provider receipts or observations

worktree cleanup with terminal close:
  observer validates product worktree reference
  observer submits terminal close intent by worktree reference
```

Acceptance:

```text
cleanup helpers no longer expose terminalTargetIdForSession or terminalTargetIdForRow to observer command handlers
session.close terminal/all paths do not call terminal.closeTarget directly
session.close terminal/all paths work when snapshots contain no provider target ids
force policy still protects running agents and dirty worktrees
removed-session events still publish when reconciliation proves the session disappeared
```

## 4. Ordering

Recommended order:

```text
1. Complete the P0 terminal ownership blocker fix.
2. Remove targetId from normal focus/close command surfaces.
3. Move session cleanup and close flows to product-level terminal intents.
4. Replace snapshot topology fields with terminal attachment state.
5. Constrain terminal providerData persistence.
6. Move concrete provider construction out of apps/observer.
7. Purge provider-shaped IDs from observer tests.
```

Reasoning:

```text
The command and snapshot cleanup becomes much smaller once observer no longer resolves provider targets for terminal actions.
Session cleanup must move before snapshot target ids disappear, otherwise session.close terminal/all behavior loses its resolver.
Persistence cleanup should happen after snapshot cleanup so old providerData is not accidentally reintroduced by row hydration.
Provider construction cleanup can happen later because it is composition leakage, not the Ghostty blocker.
```

## 5. Tests

Contract tests:

```text
terminal.focus schema rejects targetId
terminal.close schema rejects targetId
snapshot schema rejects sessionName/windowId/attached on row terminal
snapshot schema accepts provider-neutral terminal attachment state
```

Observer tests:

```text
focus command submits or records a product-level focus intent by worktree/session
close command submits or records a product-level close intent by worktree/session
session.close mode terminal/all submits product-level close intent by session/worktree
graph builds rows without exposing provider target ids
terminal providerData is not persisted into observer terminal_targets
malformed terminal providerData cannot alter snapshot row/session state
legacy terminal providerData rows do not alter current snapshot shape
```

TUI tests:

```text
focus action emits worktree/session reference, not targetId
close action emits worktree/session reference, not targetId
dashboard still displays terminal state and agent status
```

Integration tests:

```text
tmux provider still parses and owns tmux-shaped ids internally
observer real-provider smoke still starts, focuses, and closes through product intents
session.close terminal/all still closes the tmux-owned workspace through the intent boundary
debug bundle still includes enough provider diagnostic evidence without raw terminal providerData in observer tables
```

## 6. Non-Goals

This P1 plan does not require:

```text
building Ghostty support
changing Worktrunk lifecycle semantics
removing all providerData from all provider types
removing provider ids from snapshots
removing TerminalTargetObservation.id from provider observation contracts
removing terminal observations from observer reconciliation
changing harness status classification
```

## 7. Verification

Minimum verification for the P1 cleanup:

```text
pnpm --filter @wosm/contracts test
pnpm --filter @wosm/observer test
pnpm --filter @wosm/tui test
pnpm --filter @wosm/tmux test
pnpm test:all
manual tmux smoke after P0 remains green
```
