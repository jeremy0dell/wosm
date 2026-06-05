# Package And App Boundary Cleanup Audit

**Status:** Planning note
**Date:** 2026-06-05
**Severity:** P2 architecture cleanup, with one P1 runtime risk
**Applies to:** `apps/*`, `packages/*`, and provider hook integration boundaries
**Source baseline:** `docs/architecture.md`, `docs/development.md`, and current source inspection

This document records a high-level audit of the current `apps` and `packages` directories. The goal is to identify directories, abstractions, or public exports that can be deleted, collapsed, or made more explicit without weakening the runtime ownership model.

The blunt conclusion:

```text
No high-level app or package directory is an obvious delete today.
```

The current top-level shape still matches the architecture doc:

```text
observer owns runtime truth and commands
CLI owns command and debug entrypoints
TUI owns terminal UI and talks through protocol
contracts own shared schemas and types
protocol owns local observer transport
runtime owns IO/effect/error/time helper boundaries
provider-hooks owns generated hook ingress, compaction/reporting, and spool fallback
observability owns diagnostic evidence
testing owns shared fake providers and fixtures
```

The useful cleanup is smaller and more concrete: remove dead symbols, finish or delete half-wired abstractions, trim generic helper exports, and tighten boundary tests.

## 1. Straight Delete: Phase 0 Testing Placeholders

File:

```text
packages/testing/src/index.ts
```

Current dead exports:

```text
FakeProviderTestkitPlaceholder
ScriptedAgentLifecyclePlaceholder
createFakeProviderTestkitPlaceholder
createScriptedAgentLifecyclePlaceholder
```

Why this should be deleted:

These were Phase 0 placeholders. Current tests use real fake provider helpers from `@wosm/testing`; the placeholder names are not referenced outside the file.

Minimal fix:

```text
Delete the placeholder types and factories.
Keep the actual fake provider test helpers.
Run focused testing-package consumers plus the repo gate.
```

Acceptance:

```text
rg "FakeProviderTestkitPlaceholder|ScriptedAgentLifecyclePlaceholder|createFakeProviderTestkitPlaceholder|createScriptedAgentLifecyclePlaceholder"
pnpm test:unit
```

## 2. Finish Or Delete: Provider Hook Adapter Abstraction

Files:

```text
packages/contracts/src/hooks.ts
packages/provider-hooks/src/index.ts
packages/provider-hooks/src/sender.ts
integrations/harness/codex/src/hookAdapter.ts
integrations/harness/pi/src/hookAdapter.ts
integrations/worktree/worktrunk/src/hookAdapter.ts
```

Current problem:

`ProviderHookAdapter` exists in contracts, and `defaultProviderHookAdapters` exports Codex, Pi, and Worktrunk adapters. Production sender code still hard-codes provider-specific branches in `packages/provider-hooks/src/sender.ts`.

That means the abstraction is not carrying the actual behavior. Cursor also has sender support but does not participate in the exported adapter list.

Decision:

```text
Either finish the adapter path or delete it.
```

Recommended direction:

Finish it if provider hook support is expected to keep growing.

Concrete finish criteria:

```text
Provider-specific payload enrichment, scope checks, compaction, event-name normalization, and report projection run through ProviderHookAdapter.
Cursor has an adapter or is deliberately documented as a non-adapter path.
sender.ts dispatches by adapter where possible.
Provider-specific diagnostics and payload parsing remain behind provider or integration packages.
```

Delete criteria:

```text
If explicit branches are preferred, delete ProviderHookAdapter, defaultProviderHookAdapters, and provider hookAdapter files.
Keep sender.ts explicit and do not preserve an unused contracts abstraction.
```

Acceptance:

```text
No half-used exported default adapter list remains.
Existing provider hook tests still cover Codex, Cursor, Pi, and Worktrunk hook paths.
```

## 3. Possible Consolidation: Observer Startup Lifecycle

Files:

```text
apps/cli/src/observerProcess.ts
packages/provider-hooks/src/observerStartup.ts
```

Current duplication:

Both modules:

```text
resolve/check socket health
detect stale sockets
remove stale sockets
create state/socket directories
spawn observer
wait for health with retry and timeout
kill failed child process
```

This is not a protocol concern. `packages/protocol` should stay focused on local socket transport and message validation. Observer process lifecycle is orchestration, not transport.

Recommendation:

Do not add a new package just to make this look cleaner. Extract only if the two paths keep drifting or future hook/CLI work needs the same startup semantics.

Likely extraction shape if needed:

```text
small observer-process helper with injected spawn strategy
CLI supplies the default built observer entry
provider-hooks supplies required observerEntryPath
shared helper owns stale socket removal, directory creation, health wait, timeout, and child cleanup
```

Acceptance:

```text
CLI start/restart/stop behavior stays unchanged.
Provider hook auto-start still requires explicit observerEntryPath.
Startup failure and stale socket tests cover both call sites.
```

## 4. Trim Public Runtime Helper Exports

Files:

```text
packages/runtime/src/objects.ts
packages/runtime/src/index.ts
```

Current issue:

`packages/runtime` publicly exports a small JavaScript-style helper cluster:

```text
isRecord
asRecord
stringField
```

The repo now prefers strict schemas at untrusted boundaries and typed data inward. Generic probing is still valid for error normalization, redaction, and first-step schema parsing, but broad public helpers encourage drift back into loose object handling.

Recommendation:

```text
Keep only what has real generic-boundary use.
Delete unused public exports such as asRecord and stringField if no package imports them.
Consider moving isRecord to local call sites if it has only one narrow consumer.
```

Acceptance:

```text
rg "from \"@wosm/runtime\".*(asRecord|stringField)|asRecord\\(|stringField\\(" apps packages integrations
pnpm typecheck
```

## 5. Tighten TUI Provider Boundary Test

File:

```text
apps/tui/src/boundaries/import-boundaries.test.ts
```

Current issue:

The boundary test correctly forbids direct TUI imports of older provider/internal surfaces, but it does not list every current provider package.

Add explicit forbidden imports for:

```text
@wosm/cursor
@wosm/pi
@wosm/github-repository
@wosm/scripted-harness
```

Keep the intent:

```text
TUI consumes observer snapshots and dispatches typed protocol commands.
TUI must not import provider packages, read persistence, run provider CLIs, or parse raw provider payloads for core behavior.
```

Acceptance:

```text
pnpm test:unit
```

Use a package-specific focused Vitest invocation only if the repo script supports the same aliases and setup.

## 6. P1 Runtime Risk: Unbounded Observer Event Subscriber Queues

File:

```text
apps/observer/src/runtime/eventBus.ts
```

Current risk:

Each event subscriber gets an unbounded queue. A disconnected, slow, or stuck consumer can accumulate events until memory pressure becomes the failure mode.

This is not a directory cleanup issue, but it is more important than most cosmetic package reshuffling.

Possible fixes:

```text
Use a bounded queue and choose an explicit overflow policy.
Drop oldest diagnostic/event frames for lagging subscribers if event streams are best-effort.
Disconnect or mark unhealthy subscribers that exceed a lag threshold if streams need stronger delivery.
Expose subscriber lag in diagnostics if useful.
```

Acceptance:

```text
Event stream tests cover slow subscriber behavior.
Protocol subscription cleanup still calls iterator.return and releases subscriber queues.
No command or snapshot truth depends on best-effort event stream retention.
```

## Non-Deletion Candidates

These directories should stay unless a much larger product/runtime decision changes.

### `apps/observer`

Keep. It owns graph truth, commands, reconciliation, persistence, provider aggregation, diagnostics, and snapshot publication.

### `apps/cli`

Keep. It owns the user command/debug surface and observer lifecycle entrypoint.

### `apps/tui`

Keep. It is the terminal client and should remain provider-neutral.

### `packages/contracts`

Keep. Shared schemas and inferred types are the right place for cross-boundary payloads.

### `packages/protocol`

Keep. It owns local observer IPC, message validation, request/response correlation, event streaming, and client ergonomics. Beaming directly from clients to observer internals would couple callers to socket framing, transport timeout behavior, and protocol message schemas.

### `packages/config`

Keep. Config resolution is shared by CLI, observer, TUI, provider hooks, and integrations.

### `packages/runtime`

Keep, but trim generic helper creep. The useful responsibility is runtime boundary handling: effects, timeouts, retry, external commands, filesystem helpers, paths, shutdown, and error conversion.

### `packages/observability`

Keep. JSONL logs, redaction, evidence indexes, debug bundles, and retention are diagnostic evidence. Known gaps are hardening tasks, not deletion signals.

### `packages/provider-hooks`

Keep. `wosm-ingress`, bounded stdin parsing, provider hook delivery, report projection, spooling, and optional observer auto-start are a real external ingress boundary.

### `packages/testing`

Keep, but delete obsolete placeholders. Shared fake providers and fixtures are used broadly enough to justify the package.

## Suggested PR Order

1. Delete dead testing placeholders and trim unused runtime helper exports.
2. Tighten TUI provider boundary forbidden imports.
3. Decide provider hook adapter direction: finish adapter-driven sender or delete the abstraction.
4. Address observer event bus backpressure.
5. Consider observer startup consolidation only after hook/CLI startup behavior proves it is drifting.

## Done Criteria

This audit is complete when:

```text
Dead placeholder exports are gone.
TUI boundary tests cover every provider package that the TUI must not import.
ProviderHookAdapter is either the production path or removed.
Runtime helper exports do not encourage loose shape probing.
Observer event subscriptions have an explicit backpressure policy.
No new top-level app/package directory is introduced just to hide local duplication.
```
