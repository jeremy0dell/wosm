# Worktree Provider Partial Failure Isolation

**Status:** Exploration plan
**Date:** 2026-06-09
**Severity:** P1 reliability and UX correctness
**Applies to:** observer reconcile, Worktrunk provider reads, snapshot project health, TUI new-session validation
**Source baseline:** `docs/architecture.md`, `docs/development.md`, `docs/debugging.md`, current runtime logs, and current source inspection

This document captures a dogfood failure where one slow configured project caused the whole Worktrunk provider scan to look unavailable. The user-facing symptom was worse than the underlying failure: creating a new session could show "Provider operation timed out" immediately, even when the selected project was not the project that timed out.

The target product fix is narrow:

```text
One slow or broken project must not poison the entire worktree-provider scan.
```

## Incident Evidence

Runtime evidence on 2026-06-09 showed repeated Worktrunk provider list failures:

```text
Worktree provider list failed.
error.code = PROVIDER_TIMEOUT
error.provider = worktrunk
durationMs ~= 10000
```

The relevant trace was:

```text
traceId   trc_33b73c53-e34d-4b77-9d42-9a71fccc9e30
commandId cmd_6d888ef9-8f83-4c7d-a594-ea64c580415e
command   session.create
```

That command was accepted, and the tmux terminal intent was accepted quickly. It failed later because `session.create` waits for a post-create reconcile before publishing `session.created`, and the reconcile queue was already paying repeated Worktrunk timeouts.

Direct provider-command timing isolated the slow configured project:

```text
wt list --format=json in ~/Developer/wosm                    388ms
wt list --format=json in ~/Developer/synth                    51ms
wt list --format=json in ~/Developer/worktrunk               129ms
wt list --format=json in ~/Desktop/projects/GermStack   timed out after 15s
```

Plain Git also hung in the GermStack checkout:

```text
git status --short --branch in ~/Desktop/projects/GermStack timed out after 10s
```

The local `.git/index` in that checkout was marked `dataless`, and the parent Desktop folder had iCloud/File Provider attributes. That explains the local dogfood trigger, but the product bug is broader: any slow project can currently degrade the global worktree provider and block unrelated session creation.

## Current Code Path

Worktrunk listing is per project:

```text
integrations/worktree/worktrunk/src/provider.ts
  WorktrunkProvider.listWorktrees(project)
  -> wt list --format=json
  -> cwd = project.root
```

Observer reconcile calls that once per configured project:

```text
apps/observer/src/reconcile/run.ts
  readWorktreeObservations(...)
  for (const project of input.projects) {
    result = provider.listWorktrees(project)
    if (!result.ok) {
      record failed provider health
      break
    }
  }
```

The important behavior is the `break`. After the first list failure, later configured projects are not observed in that reconcile.

The snapshot then assigns the same global worktree-provider health to every project:

```text
apps/observer/src/reconcile/graph.ts
  project.health = providerHealth[worktreeProviderId]
```

The TUI new-session flow blocks immediately when the selected project health is unavailable:

```text
apps/tui/src/flows/newSession.ts
  if (project.health.status === "unavailable") return project.health.lastError
```

That is why the UI can show "Provider operation timed out" instantly. It is not necessarily waiting for a new provider call. It can be displaying cached global provider health from a prior background reconcile.

## Problem Statement

The observer currently conflates three different states:

```text
provider binary is unavailable
provider cannot list any project
provider failed for one configured project
```

Only the first two should make the global worktree provider unavailable.

One project-specific read failure should:

```text
record a project-scoped error
continue scanning other configured projects
keep unrelated projects usable
surface a clear project-local warning in the TUI and diagnostics
```

## Recommended Direction

### 1. Continue After Project List Failures

Change `readWorktreeObservations` so a failed `listWorktrees(project)` records the project failure and continues to the next project instead of breaking.

The provider-level health should become aggregate:

```text
healthy     all enabled project reads succeeded
degraded    at least one enabled project read failed, at least one succeeded
unavailable provider health check failed, or every enabled project read failed
```

This keeps the global provider status useful without letting one slow checkout block the rest of the workspace.

### 2. Add Project-Scoped Worktree Health

Snapshot project health currently reuses the global worktree-provider health. That is too coarse.

Add a project-scoped health record for the active worktree provider, likely by extending `ProjectView` with a worktree-provider health/error field or by making `ProjectView.health` project-specific during graph construction.

The project-local health should include:

```text
providerId
providerType = worktree
status
lastCheckedAt
lastError
latencyMs
```

Avoid provider-specific fields in observer/core. The error can remain a normal `SafeError` returned by the provider boundary.

### 3. Keep TUI Validation Project-Scoped

The new-session validation should continue to block a project whose own worktree provider status is unavailable.

It should not block project A because project B timed out.

Expected UX:

```text
wosm project healthy        new session can be submitted
GermStack project failed    GermStack new session shows project-local provider timeout
global provider degraded    dashboard/status can show a warning, not a universal blocker
```

### 4. Show Project-Local UI State

The TUI should distinguish "this project scan failed" from "this project has zero worktrees." `0 worktrees` should mean the provider successfully scanned the project and found no rows. A failed scan should get its own project-local state.

For a project with no usable rows because the latest scan failed:

```text
▼ GermStack - unavailable | codex
 ! Worktree scan timed out
   Run: wosm doctor --project germstack
```

For a project with previously known rows but a failed latest scan:

```text
▼ GermStack - 3 worktrees | codex | scan stale
 [a] ○ main                              codex     idle
 [b] ○ feature-x                         codex     idle
 [c] ○ fix-y                             codex     idle
 ! Latest worktree scan timed out
   Run: wosm doctor --project germstack
```

Healthy projects should remain selectable and actionable. Do not show a global modal, global blocker, or repeated toast for one background project failure. A global banner is appropriate only when the provider binary/config is unavailable or every enabled project fails.

The new-session project picker should block only the affected project:

```text
1 wosm
2 synth
3 GermStack unavailable
4 worktrunk
```

If the user selects the unavailable project, show modal-local validation with the diagnostic command:

```text
GermStack worktree scan timed out.
Run: wosm doctor --project germstack
```

Use status color sparingly:

```text
unavailable project read    red
stale/degraded read         yellow
global provider degraded    subtle status indicator, not a blocking error
```

The first diagnostic hint should use the existing runtime diagnostic surface:

```bash
wosm doctor --project <projectId>
```

For config-only project checks, `wosm project doctor <projectId>` can remain separate. The TUI should prefer `wosm doctor --project <projectId>` for runtime provider failures because it can include observer/provider state.

If project-scoped debug filtering does not exist when this is implemented, add it instead of making users search global logs manually:

```bash
wosm debug logs --project <projectId> "Worktree provider list failed" --limit 10
```

Until that exists, the lower-quality fallback is:

```bash
wosm debug logs "Worktree provider list failed" --limit 10
```

### 5. Preserve Diagnostics

Debug logs and diagnostic bundles should identify the project that failed.

Recommended log attributes:

```text
provider
projectId
projectRoot
error
durationMs
```

This would have made the GermStack incident obvious without manually timing each configured project.

The project-scoped diagnostic command should summarize the same state the TUI uses. If `wosm doctor --project <projectId>` does not yet report project-scoped worktree provider failures, update it as part of the diagnostics work.

### 6. Consider Effect At The Provider Read Boundary

This is a good candidate for Effect-style orchestration, but only at the runtime/provider boundary. The goal is structured concurrency, cancellation, timeout, retry, and result collection. The goal is not to spread Effect through snapshot mappers, contracts, TUI validation, or row rendering.

A useful shape would be a small helper such as:

```text
collectProviderReads(projects, readProject, policy)
```

That helper could internally use Effect to:

```text
apply one timeout per project read
retry only safe read operations
interrupt subprocess work on timeout or observer shutdown
collect successes and failures instead of throwing on the first failure
preserve projectId, projectRoot, trace/span, and operation context
optionally bound concurrency
```

Pseudo-shape:

```ts
Effect.forEach(
  projects,
  (project) =>
    listWorktrees(project).pipe(
      timeout(providerTimeout),
      retry(safeReadRetryPolicy),
      Effect.either,
      annotateLogs({ projectId: project.id, projectRoot: project.root }),
    ),
  { concurrency: 2 },
);
```

Start conservative. A serial-but-continue implementation is enough to fix the poisoning bug. Bounded concurrency can be added once tests prove provider calls are isolated and cancellation is correct. Worktrunk shells out and touches Git/filesystem state, so unbounded parallel listing would be the wrong default.

## Non-Goals

Do not fix this by only increasing timeouts. The failure mode is not that 10s is too short. It is that a single slow project is allowed to block unrelated projects and commands.

Do not move Worktrunk-specific branching into the TUI. The TUI should consume project-scoped snapshot health, not run `wt`, inspect Git, or special-case Worktrunk errors.

Do not make observer/core parse provider-specific `providerData`. Worktree-provider adapters should normalize errors and observations at the boundary.

Do not hide the degraded state. Users should still see that one configured project is unhealthy.

## Implementation Sketch

Likely PR shape:

```text
PR 1: Observer and contract behavior
  - add project-scoped worktree read health/error to snapshot contracts
  - continue worktree observation after per-project list failure
  - make provider health aggregate partial success as degraded
  - add projectId/projectRoot to provider-list-failure logs
  - update fake-provider reconcile tests

PR 2: TUI and diagnostics polish
  - make new-session validation use project-scoped worktree health
  - render project-local provider warnings without blocking unrelated projects
  - show wosm doctor --project <projectId> as the first remediation hint
  - optionally add wosm debug logs --project <projectId> filtering
  - update debug/diagnostic evidence to summarize project-scoped failures
```

If the contract change is small and tests stay focused, these can be one PR. Split only if snapshot migration and TUI UX review become noisy.

## Test Strategy

Add a reconcile test with three projects:

```text
project-a list succeeds
project-b list times out/fails
project-c list succeeds
```

Assert:

```text
rows from project-a and project-c are present
project-b has unavailable/degraded project worktree health
global worktree provider health is degraded, not unavailable
the provider-list-failure log includes project-b identifiers
observer snapshot remains healthy enough for unrelated project commands
```

Add a TUI validation test:

```text
selected project healthy + global worktree provider degraded -> create is allowed
selected project unavailable -> create is blocked with that project error
selected project unavailable -> validation includes wosm doctor --project <projectId>
```

Add a TUI rendering test:

```text
successful empty project -> shows 0 worktrees
failed empty project -> shows unavailable and diagnostic command
failed project with cached rows -> shows scan stale without hiding cached rows
```

Add a regression for ordering:

```text
if the middle project fails, later projects are still scanned
```

Focused gates:

```bash
pnpm test:contracts
pnpm test:integration
pnpm test:unit
```

Run `pnpm test:all` before shipping if the snapshot contract changes.

## Manual Verification

Reproduce with one intentionally slow project or with a checkout whose Git status hangs.

Before the fix:

```text
wosm observer status
  providerHealth.worktrunk.status = unavailable
  lastReconcile.projectsScanned stops before later configured projects

new session from an unrelated project can immediately show Provider operation timed out
```

After the fix:

```text
wosm observer status
  providerHealth.worktrunk.status = degraded when some projects still scan
  lastReconcile scans all configured projects

wosm snapshot --json
  unhealthy project has project-scoped worktree error
  unrelated projects remain usable

wosm debug logs "Worktree provider list failed" --limit 10
  failing records include projectId and projectRoot

TUI dashboard
  failed project shows unavailable or scan stale, not 0 worktrees
  failed project shows Run: wosm doctor --project <projectId>
  unrelated projects remain openable
```

## Open Questions

Should `ProjectView.health` remain a single worktree-provider health object, or should it become a named health map as WOSM grows more project-scoped providers?

Should a project with `worktrunk.enabled = false` expose `unknown`, `healthy`, or an explicit disabled state for worktree health?

Should observer health be `degraded` when any project fails, or only when the failed project has visible rows/sessions? The conservative default is degraded because configured project truth is incomplete.

Should the command path bypass a stale global unavailable state when a selected project had a recent healthy project-scoped read? This may be unnecessary if snapshot health becomes project-scoped.

Should `wosm debug logs --project <projectId>` be a general log-filtering flag, or should this be a narrower provider-focused command? The first TUI hint does not depend on this because `wosm doctor --project <projectId>` already exists.
