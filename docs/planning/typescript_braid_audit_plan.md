# TypeScript Braid Remediation Plan - P0/P1

**Status:** Executed remediation record  
**Date:** 2026-05-21  
**Applies to:** current implementation after diagnostics, persistence, observer graph, Worktrunk, tmux, protocol, and harness integration slices  
**Source baseline:** `docs/planning/wosm_rebuild_tdd_final_v1.md`, `docs/planning/wosm_phased_development_cycle_final_v1.md`, and the broad TypeScript audit performed on 2026-05-21

This document records the P0 and P1 TypeScript/codebase improvements found during the broad TypeScript audit and the execution status of the remediation pass.

Execution note, 2026-05-21:

```text
Implemented: P0.1, P0.2, observer slice of P0.3, P1.1, P1.2, P1.3, P1.4
Documented: P1.5
Still useful as follow-up: full public export inventory across CLI/testing/integration barrels, generated declaration review, and real Worktrunk smoke test
```

The goal is not a cosmetic type refactor. The goal is to protect the long-term shape of wosm by making the shared type language more intentional, harder to misuse, and easier for future agents to extend without creating parallel concepts.

The guiding direction:

```text
contracts define shared language
config parses user intent
providers adapt external truth into contracts
observer correlates and persists
protocol validates transport messages
apps consume typed APIs
```

## 1. Audit Snapshot

The audit scanned TypeScript source under `apps`, `packages`, and `integrations`, plus representative tests.

Audit baseline rough counts before this remediation pass:

```text
177 TypeScript source files
323 TypeScript declarations
302 exported declarations
140 schema constants
3 duplicate declaration names found by AST scan
0 any usages in production source by word scan
0 @ts-ignore or @ts-expect-error usages by scan
0 ...(await ...) spread sites by scan
```

Validation run during the audit:

```text
pnpm typecheck
pnpm lint
pnpm test:contracts
pnpm test:unit
pnpm test:integration
pnpm test:diagnostics
pnpm test:e2e
pnpm test:agent:scripted
```

All passed. `tests/e2e/worktrunk-real.test.ts` was skipped by design because `WOSM_REAL_WORKTRUNK=1` was not set.

## 2. Priority Definitions

P0 means foundational type or boundary work that should happen before more command, provider, protocol, or persistence surface area grows around the current shape.

P1 means high-leverage cleanup that is not immediately blocking, but should be handled soon to avoid making accidental public APIs, duplicate concepts, or hard-to-review schema files permanent.

Out of scope for this plan:

```text
TUI implementation and TUI type surface
purely cosmetic type renames
full generated declaration review
real Worktrunk smoke execution
```

## 3. P0 Items

### P0.1 Make Id Types Type-Distinct

Problem:

`ProjectId`, `WorktreeId`, `SessionId`, `TerminalTargetId`, `HarnessRunId`, `CommandId`, `EventId`, and `ProviderId` all infer to plain `string`.

Primary file:

```text
packages/contracts/src/ids.ts
```

Why this matters:

Runtime schemas validate ids at boundaries, but internal TypeScript cannot prevent passing a session id where a worktree id belongs. As more commands, persistence records, protocol methods, and provider adapters are added, plain-string ids become one of the easiest ways to create subtle correlation bugs.

Direction:

Introduce branded scalar ids in `@wosm/contracts`, while preserving JSON wire compatibility.

Possible shape:

```ts
type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type ProjectId = Brand<string, "ProjectId">;
export type WorktreeId = Brand<string, "WorktreeId">;
export type SessionId = Brand<string, "SessionId">;
```

Implementation notes:

```text
Keep schemas parsing strings from JSON.
Add helper constructors/parsers only where they clarify boundary crossings.
Avoid mass assertions in provider implementations.
Expect a staged migration if the branded ids touch too many files at once.
```

Acceptance:

```text
Id types are no longer mutually assignable without parsing, construction, or explicit conversion.
Protocol and persisted JSON payloads remain strings.
Provider implementations remain JSON-safe.
At least one type-only test or compile-time fixture proves an id-kind mismatch is rejected.
```

### P0.2 Schema-Back ProviderProjectConfig

Problem:

`ProviderProjectConfig` is central to provider and observer boundaries, but it is currently a hand-written type without a companion schema.

Primary files:

```text
packages/contracts/src/providers.ts
apps/observer/src/reconcile/core.ts
```

Why this matters:

Provider-facing project data is one of the most important boundary payloads in the system. If it drifts from config-derived project data, provider code can grow assumptions that are not contract-checked.

Direction:

Add `ProviderProjectConfigSchema` and derive `ProviderProjectConfig` from it.

Compose from shared schemas where useful:

```text
ProjectIdSchema
ProviderIdSchema
ProjectDefaultsSchema or equivalent shared defaults schema
ProjectRecoveryBreadcrumbsSchema or equivalent shared breadcrumbs schema
```

Acceptance:

```text
ProviderProjectConfig is z.infer<typeof ProviderProjectConfigSchema>.
providerProjectsFromConfig constructs or validates against the schema.
Tests prove config-derived provider projects reject malformed shape.
No provider-specific fields are added to the shared project config.
```

### P0.3 Stop Accidental Public API Growth

Problem:

Top-level package barrels export too much, especially `@wosm/observer`.

Primary files:

```text
apps/observer/src/index.ts
apps/cli/src/index.ts
packages/testing/src/index.ts
integrations/*/*/src/index.ts
```

Current smell:

`@wosm/observer` exports queues, persistence, migrations, SQLite handles, graph builders, provider registry/factory, runtime API, and server plumbing from one public barrel.

Why this matters:

If everything is exported, future code and agents will naturally depend on the wrong layer. Internal helper types become harder to rename or consolidate later.

Direction:

Inventory exports and split surfaces intentionally.

Possible shape:

```text
@wosm/observer
  public create/start APIs only

@wosm/observer/internal
  test and integration setup helpers, if needed

source-relative imports
  implementation modules inside the same package
```

This should begin as an inventory before implementation.

Acceptance:

```text
Every top-level export is classified as public, test-support, package-internal, or accidental.
Observer and CLI barrels expose only intended cross-package APIs.
Tests retain supported imports for integration setup.
No production package imports observer persistence or migrations through the public barrel unless explicitly intended.
```

## 4. P1 Items

### P1.1 Rename Persistence Row Types And Narrow Persisted States

Problem:

There are two exported `WorktreeRow` declarations:

```text
packages/contracts/src/snapshot.ts
apps/observer/src/persistence/rows.ts
```

The first is a user-facing snapshot row. The second is a SQLite row.

Persistence records also expose some state-like fields as plain `string`.

Primary files:

```text
apps/observer/src/persistence/rows.ts
apps/observer/src/persistence/types.ts
apps/observer/src/persistence/*.ts
packages/contracts/src/snapshot.ts
```

Why this matters:

The duplicate name is a review trap. Loose persisted states make it unclear whether database data has been reconciled back into contract enums.

Direction:

Rename SQLite row types with an explicit prefix:

```text
SqliteCommandRow
SqliteEventRow
SqliteWorktreeRow
SqliteTerminalTargetRow
SqliteHarnessRunRow
SqliteSessionRow
SqliteRecoveryBreadcrumbRow
```

Then narrow persisted domain records where practical:

```text
PersistedWorktree.state?: WorktreeState
PersistedTerminalTarget.state?: TerminalState
PersistedHarnessRun.state?: AgentState
PersistedHarnessRun.confidence?: Confidence
```

Acceptance:

```text
No exported persistence row type shares a name with a contract view type.
Row conversion functions parse or narrow enum-like fields before exposing persisted records.
Persistence tests cover the chosen invalid-state policy where practical.
```

### P1.2 Decompose Command And Event Schemas Into Named Variants

Problem:

`WosmCommandSchema` and `WosmEventSchema` are correct but already dense inline discriminated unions.

Primary files:

```text
packages/contracts/src/commands.ts
packages/contracts/src/events.ts
packages/protocol/src/messages.ts
tests/contract-fixtures
```

Why this matters:

Commands and events will grow. If each variant stays inline, future additions will be harder to review and more likely to duplicate payload fragments instead of composing shared pieces.

Direction:

Extract named per-command and per-event schema constants, then assemble the final union unchanged.

Possible shape:

```ts
export const WorktreeCreateCommandSchema = z
  .object({ type: z.literal("worktree.create"), payload: CreateWorktreePayloadSchema })
  .strict();

export const WosmCommandSchema = z.discriminatedUnion("type", [
  WorktreeCreateCommandSchema,
  // ...
]);
```

Acceptance:

```text
Each command and event variant has a named schema export.
WosmCommand and WosmEvent remain wire-compatible.
Contract fixtures pass unchanged unless a wire-shape change is intentionally planned.
New variant schemas are grep-friendly and individually reviewable.
```

### P1.3 Add Provider-Local providerData Schemas

Problem:

`providerData?: unknown` is the right shared-contract escape hatch, but provider packages sometimes read structured provider data through ad hoc record checks.

Primary files:

```text
packages/contracts/src/shared.ts
packages/contracts/src/observations.ts
integrations/worktree/worktrunk/src/metadata.ts
integrations/worktree/worktrunk/src/parse.ts
integrations/terminal/tmux/src/parse.ts
integrations/terminal/tmux/src/launch.ts
integrations/harness/scripted/src/events.ts
integrations/harness/scripted/src/statusPolicy.ts
```

Why this matters:

Core should stay provider-neutral, but provider packages still deserve local safety when they read their own structured provider data.

Direction:

Keep `providerData` as `unknown` in `@wosm/contracts`. Add provider-local schemas or typed parsers inside integration packages.

Examples:

```text
WorktrunkProviderDataSchema
TmuxTargetProviderDataSchema
ScriptedHarnessProviderDataSchema
```

Acceptance:

```text
Provider code that reads providerData does so through provider-local parsing helpers.
Observer/core does not import provider-data schemas.
Provider tests cover malformed providerData for paths that read it.
```

### P1.4 Clarify Safe Error Type Ownership

Problem:

Canonical `SafeError` lives in contracts. Runtime has `RuntimeSafeError`, observability has `SafeErrorFallback`, and config defines a local `SafeError` type for `ConfigError.toSafeError`.

Primary files:

```text
packages/contracts/src/errors.ts
packages/runtime/src/errors.ts
packages/observability/src/errors.ts
packages/config/src/load/errors.ts
```

Why this matters:

The current duplication is understandable, but the name `SafeError` should mean one thing across the workspace: the contract-safe UI/protocol error shape.

Direction:

Keep runtime independent if needed, but avoid additional exported or local shapes named exactly `SafeError`.

Preferred config shape:

```text
ConfigError.toSafeError(): SafeError
```

where `SafeError` comes from `@wosm/contracts`, if package dependency direction remains acceptable.

Fallback:

```text
ConfigSafeErrorShape
```

Acceptance:

```text
There is only one exported type named SafeError.
Fallback/input shapes are named as fallbacks or inputs, not canonical errors.
Config safe errors still pass SafeErrorSchema in tests.
```

### P1.5 Document exactOptionalPropertyTypes Usage For Domain Types Vs Option Bags

Problem:

Domain payloads generally preserve absent-vs-undefined semantics. Many local dependency and options bags use `?: T | undefined`.

Primary examples:

```text
apps/observer/src/commands/session/shared.ts
apps/observer/src/commands/router.ts
apps/cli/src/commands/*.ts
```

Why this matters:

The distinction is currently mostly intuitive. Future agents need a written convention so exact optional semantics stay meaningful in payloads, persistence, diagnostics, and provider parsing.

Direction:

Document the convention rather than churn every options bag:

```text
Domain, payload, persistence, diagnostic, and provider parsing types: prefer field?: T.
Dependency, test, and local options bags: field?: T | undefined is acceptable when callers commonly forward maybe-undefined values.
```

Acceptance:

```text
The convention is recorded in planning docs or AGENTS.md.
New domain/shared payload types avoid ?: T | undefined.
Existing local options bags are cleaned only when touched for nearby work.
```

## 5. Suggested Work Order

Recommended order:

```text
1. P0.3 public export inventory
2. P0.2 ProviderProjectConfig schema
3. P0.1 branded id design and staged migration
4. P1.1 persistence row naming and state narrowing
5. P1.2 command/event schema decomposition
6. P1.3 providerData local schemas
7. P1.4 safe error naming cleanup
8. P1.5 exact optional convention documentation
```

Reasoning:

Start by understanding public exports before changing type primitives. Then schema-back central provider project data. Branded ids are likely the broadest change, so they should follow a concrete migration plan. Persistence naming, schema decomposition, and providerData cleanup can then be handled in smaller focused slices.

## 6. Guardrails

Do:

```text
Keep strict schemas for untrusted input and shared payloads.
Prefer z.infer for shared runtime payload types.
Use typed local builders for complex exact-optional object construction.
Keep provider-specific behavior behind integration/provider boundaries.
Preserve JSON compatibility for protocol and persisted payloads.
Write characterization tests before changing contract shape.
```

Do not:

```text
Disable exactOptionalPropertyTypes.
Turn providerData into a shared provider-specific union in contracts.
Move Worktrunk, tmux, Codex, or OpenCode specifics into observer core.
Big-bang refactor every options bag.
Change command/event wire shapes without fixture updates and migration notes.
Include TUI work in this remediation plan.
```

## 7. Follow-Up Agent Prompts

### Public Export Inventory

```text
Read docs/planning/typescript_braid_audit_plan.md and perform only P0.3. Do not refactor. Inspect apps/observer/src/index.ts, apps/cli/src/index.ts, packages/testing/src/index.ts, packages/contracts/src/index.ts, packages/protocol/src/index.ts, and integrations/*/*/src/index.ts. Output a table of exported symbols grouped as public, test-support, package-internal, or accidental, then recommend a minimal public/internal split.
```

### ProviderProjectConfig Schema

```text
Read docs/planning/typescript_braid_audit_plan.md and implement P0.2 only. Add ProviderProjectConfigSchema in @wosm/contracts, derive ProviderProjectConfig from it, validate config-to-provider project construction, and keep provider-specific fields out of the shared shape. Run contract, observer unit, and integration tests.
```

### Branded Id Design

```text
Read docs/planning/typescript_braid_audit_plan.md and design P0.1 only. Do not implement until the migration plan names the exact files and test strategy. Preserve JSON wire compatibility and avoid mass unsafe casts.
```

### Persistence Cleanup

```text
Read docs/planning/typescript_braid_audit_plan.md and implement P1.1 only. Rename SQLite row types to Sqlite*Row, keep behavior unchanged, and add or update focused persistence tests if state narrowing is introduced.
```

### Command/Event Schema Decomposition

```text
Read docs/planning/typescript_braid_audit_plan.md and implement P1.2 only. Refactor WosmCommandSchema and WosmEventSchema into named per-variant schema constants without changing wire shape. Keep all contract fixtures passing.
```

### ProviderData Schema Audit

```text
Read docs/planning/typescript_braid_audit_plan.md and implement P1.3 only. Audit providerData reads in integration packages. Add provider-local schemas or typed parsers where providerData is read, keep providerData unknown in @wosm/contracts, and do not import provider-specific schemas into observer core.
```

## 8. Open Audit Gaps

The broad TypeScript audit did not run the opt-in real Worktrunk smoke test.

Command:

```bash
WOSM_REAL_WORKTRUNK=1 pnpm test:e2e:worktrunk:real
```

The audit also did not perform a full generated declaration review of `dist/*.d.ts`. If public API stability becomes a priority, run:

```bash
pnpm build
find apps packages integrations -path '*/dist/*.d.ts' -print
```

and review generated declarations for accidental exports.

## 9. Exit Criteria

This plan is complete when:

```text
Id kinds are type-distinct where practical.
ProviderProjectConfig is schema-backed.
Public package barrels expose intentional surfaces only.
Persistence row names cannot be confused with contract view names.
Command and event schemas are decomposed into named variants.
ProviderData reads are provider-local and schema-backed.
SafeError has one canonical workspace meaning.
exactOptionalPropertyTypes conventions are documented for future agents.
The full non-real test matrix stays green.
```
