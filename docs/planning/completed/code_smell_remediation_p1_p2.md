# Code Smell Remediation Plan - P1/P2

**Status:** Planning addendum  
**Date:** 2026-05-21  
**Applies to:** current implementation after diagnostics, persistence, observer graph, Worktrunk, tmux, and harness integration slices  
**Source baseline:** `docs/planning/historical/wosm_rebuild_tdd_final_v1.md`

This document records the P1 and P2 remediation work found during the code smell audit.

The goal is not to make a cosmetic style sweep. The goal is to remove code patterns that hide domain intent, weaken provider boundaries, duplicate validation logic, or make strict optional-field handling harder to audit.

## 1. Audit Snapshot

The audit scanned `apps`, `packages`, `integrations`, and `tests`.

Current rough counts:

```text
345 total spread-expression sites shaped like ...(...)
304 empty-object or empty-array ternary spread sites
287 exact undefined/null ? {} : { ... } object-spread sites
3 ...(await ...) sites
21 deep optional-chain sites such as config?.worktree?.worktrunk
24 SomeSchema.parse({ ... }) object-construction sites
1 clear provider-boundary violation in observer diagnostics
```

These counts are not acceptance criteria by themselves. They identify hotspots. The implementation should reduce the risky patterns where they obscure boundaries or invariants, not chase a zero count.

## 2. Remediation Rules

Every item in this plan should be handled red-first when practical:

```text
write or update focused tests
observe the expected failure or preserve current behavior with a characterization test
implement the change
make the focused tests pass
run the relevant package tests
keep main green
```

Use these rules while changing code:

```text
Do not disable exactOptionalPropertyTypes.
Do not replace strict schemas with loose object types.
Do not big-bang all conditional spreads in the repo.
Do not move provider-specific behavior into observer core.
Do not change public contract shape unless tests and schemas are updated together.
```

Plain TypeScript object builders are preferred for complex domain construction. Conditional spreads are acceptable only for small, local, obvious cases. At boundaries, runtime schemas remain useful, but intermediate values should be typed whenever that clarifies invariants before schema parsing.

## 3. P1 Items

### P1.1 Move Worktrunk Doctor Logic Behind A Provider Boundary

Problem:

Observer diagnostics directly import and invoke Worktrunk-specific hook diagnostics. This conflicts with the rebuild ownership model: Worktrunk is an integration, not a core observer concept.

Primary files:

```text
apps/observer/src/diagnostics/collector.ts
apps/observer/src/providers/registry.ts
apps/observer/src/providers/factory.ts
packages/contracts/src/providers.ts
integrations/worktree/worktrunk/src/hooks.ts
integrations/worktree/worktrunk/src/provider.ts
apps/observer/test/integration/worktrunk-diagnostics.test.ts
apps/observer/test/integration/diagnostics-collector.test.ts
```

Current smell:

```ts
import { doctorWorktrunkHooks } from "@wosm/worktrunk";

const checks = [
  observerCheck,
  configCheck,
  ...(await worktrunkHookChecks(deps)),
  retentionCheck,
];
```

Direction:

Add a provider-facing diagnostics capability instead of hard-coding Worktrunk in observer diagnostics. The observer should aggregate provider diagnostic checks through an interface or injected collector.

Possible shape:

```ts
export type ProviderDoctorCheck = {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  error?: SafeError;
};

export type WorktreeProvider = {
  // existing fields...
  doctorChecks?: () => Promise<ProviderDoctorCheck[]>;
};
```

An injected diagnostics collector is also acceptable if that fits existing registry boundaries better:

```ts
const providerChecks = await deps.providerDiagnostics.collectDoctorChecks();
```

Acceptance:

```text
apps/observer/src/diagnostics/collector.ts no longer imports @wosm/worktrunk
observer diagnostics do not branch on the string "worktrunk" for hook-specific behavior
Worktrunk hook doctor behavior is still reported in doctor output
fake providers can contribute no checks or test checks without importing Worktrunk
existing Worktrunk diagnostics integration tests still pass
```

Suggested tests:

```text
observer doctor includes provider-contributed diagnostic checks
observer doctor has no provider checks when provider exposes none
Worktrunk provider contributes worktrunk-hooks warning when hooks are missing
Worktrunk provider contributes worktrunk-hooks ok when hooks are installed
```

### P1.2 Replace Recovery Breadcrumb Mega-Validator With A Strict Schema

Problem:

Recovery breadcrumbs are untrusted disk JSON, but validation is a hand-written mega-condition. It is hard to audit, gives coarse errors, duplicates the project schema style, and then reconstructs the object using conditional spreads.

Primary files:

```text
apps/observer/src/hooks/breadcrumbs.ts
apps/observer/test/unit/breadcrumbs.test.ts
packages/contracts/src/ids.ts
packages/contracts/src/shared.ts
```

Current smell:

```ts
if (
  record.schemaVersion !== 1 ||
  record.createdBy !== "wosm" ||
  typeof record.projectId !== "string" ||
  record.projectId.length === 0 ||
  typeof record.createdAt !== "string" ||
  Number.isNaN(Date.parse(record.createdAt)) ||
  ...
) {
  throw new RecoveryBreadcrumbError(
    "RECOVERY_BREADCRUMB_INVALID",
    "Recovery breadcrumb has invalid fields.",
  );
}
```

Direction:

Use a strict schema with `safeParse`, then map schema failures to `RecoveryBreadcrumbError`.

Possible shape:

```ts
const RecoveryBreadcrumbSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: nonEmptyStringSchema,
    worktreeId: nonEmptyStringSchema.optional(),
    sessionId: nonEmptyStringSchema.optional(),
    createdBy: z.literal("wosm"),
    createdAt: TimestampSchema,
    provider: nonEmptyStringSchema.optional(),
    note: z.string().min(1).max(240).optional(),
  })
  .strict();
```

If the schema must stay local to avoid exporting a premature contract, keep it local but use the same primitive validators as the contracts package where appropriate.

Acceptance:

```text
unsupported fields still fail
non-object payloads still fail
empty projectId/worktreeId/sessionId/provider/note still fail
overlong note still fails
unsafe keys such as token, secret, prompt, transcript still fail before validation
valid breadcrumbs still round-trip through writeRecoveryBreadcrumb/readRecoveryBreadcrumbFile
Date validation is explicit and matches the project's timestamp expectations
```

Suggested tests:

```text
rejects extra fields
rejects invalid createdAt format
rejects unsafe recovery payload fields
rejects empty optional identifiers
accepts minimal valid breadcrumb
accepts valid breadcrumb with worktreeId, sessionId, provider, and note
```

### P1.3 Unify Breadcrumb Metadata Parsing

Problem:

Worktrunk parses breadcrumb metadata separately from observer breadcrumb validation. That creates two validation stories for the same file format.

Primary files:

```text
apps/observer/src/hooks/breadcrumbs.ts
integrations/worktree/worktrunk/src/metadata.ts
integrations/worktree/worktrunk/test/unit/metadata.test.ts
apps/observer/test/unit/breadcrumbs.test.ts
```

Current smell:

```ts
const record = asRecord(value);
if (record?.createdBy !== "wosm" || record.schemaVersion !== 1) {
  return undefined;
}

const projectId = stringValue(record.projectId);
```

Direction:

Make Worktrunk consume the same validated breadcrumb shape, or extract a shared metadata parser/schema that both observer hooks and Worktrunk metadata can use without violating package boundaries.

Important boundary note:

Do not make `integrations/worktree/worktrunk` import from `apps/observer`. If sharing is needed, move the schema/parser to a neutral package such as `packages/contracts` or a small shared package that does not depend on observer internals.

Acceptance:

```text
only one authoritative schema/parser defines recovery breadcrumb field validity
Worktrunk metadata parsing ignores invalid breadcrumbs safely
Worktrunk metadata parsing accepts the same valid breadcrumb shape as observer hooks
no integration package imports from apps/observer
tests cover malformed JSON, unsupported fields, wrong projectId, missing projectId, and valid metadata
```

### P1.4 Fix Diagnostics Required/Optional Mismatch

Problem:

`runDoctor` treats fields as optional even though this collector always creates them and `DoctorReportSchema` requires them. This hides invariants and risks runtime schema failure instead of compile-time pressure.

Primary files:

```text
apps/observer/src/diagnostics/collector.ts
packages/contracts/src/diagnostics.ts
apps/observer/test/integration/diagnostics-collector.test.ts
apps/observer/test/integration/worktrunk-diagnostics.test.ts
```

Current smell:

```ts
status: snapshot.configSummary?.diagnostics.length === 0 ? "ok" : "warn",
message: `${snapshot.configSummary?.projectCount ?? 0} project(s) configured.`,

status: snapshot.localState?.overLimit === true ? "warn" : "ok",
message: `Local state uses ${snapshot.localState?.totalBytes ?? 0} bytes.`,

config: snapshot.configSummary,
localState: snapshot.localState,
retention: snapshot.retention,
```

Direction:

Either define a narrowed doctor snapshot type that requires `configSummary`, `localState`, and `retention`, or have `runDoctor` construct required values before building the report.

Possible shape:

```ts
type DoctorDiagnosticSnapshot = DiagnosticSnapshot & {
  configSummary: NonNullable<DiagnosticSnapshot["configSummary"]>;
  localState: NonNullable<DiagnosticSnapshot["localState"]>;
  retention: NonNullable<DiagnosticSnapshot["retention"]>;
};
```

Acceptance:

```text
runDoctor no longer uses optional chaining for configSummary/localState/retention
DoctorReport construction is type-correct before DoctorReportSchema.parse
missing required diagnostic state is impossible or converted into a clear typed error
doctor tests still prove healthy/degraded status behavior
```

## 4. P2 Items

### P2.1 Remove Production Surprise Async Spreads

Problem:

Awaiting inside spread expressions hides IO in data construction.

Primary files:

```text
apps/observer/src/diagnostics/collector.ts
apps/observer/src/reconcile/run.ts
```

Current smell:

```ts
...(await worktrunkHookChecks(deps)),
```

```ts
harnessRuns.push(
  ...(await classifyHarnessRuns({
    provider,
    capabilities,
    runs: result.value,
    ...
  })),
);
```

Direction:

Use named locals before constructing arrays.

Preferred shape:

```ts
const hookChecks = await collectProviderDoctorChecks(deps);

const checks = [
  observerCheck(snapshot),
  configCheck(snapshot),
  sqliteCheck(snapshot),
  providersCheck(snapshot),
  ...hookChecks,
  retentionCheck(snapshot),
];
```

```ts
const classifiedRuns = await classifyHarnessRuns({
  provider,
  capabilities,
  runs: result.value,
  projects: input.projects,
  worktrees: input.worktrees,
  terminalTargets: input.terminalTargets,
  read: input.read,
  providerHealth: input.providerHealth,
  errors: input.errors,
});

harnessRuns.push(...classifiedRuns);
```

Acceptance:

```text
no production code contains ...(await ...)
tests/diagnostics/boundary-inventory.test.ts may keep files.push(...(await walk(...))) or can be cleaned opportunistically
behavior is unchanged
```

### P2.2 Refactor Conditional Spread Hotspots

Problem:

The repo has about `287` conditional optional-object spreads. The pattern exists for a good reason, because `exactOptionalPropertyTypes` is enabled, but the concentration in mapper files makes the code harder to read and audit.

Do not sweep the whole repo. Start with files where the density hides domain logic.

Primary hotspots:

```text
apps/observer/src/persistence/rows.ts
apps/observer/src/reconcile/graph.ts
packages/observability/src/errors.ts
apps/observer/src/diagnostics/collector.ts
apps/observer/src/runtime/api.ts
apps/observer/src/commands/session/shared.ts
```

Current smell:

```ts
return {
  id: row.id,
  type: command.type,
  command,
  status: row.status,
  createdAt: row.created_at,
  ...(row.started_at === null ? {} : { startedAt: row.started_at }),
  ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  ...(row.trace_id === null ? {} : { traceId: row.trace_id }),
  ...(row.span_id === null ? {} : { spanId: row.span_id }),
  ...(row.error_json === null ? {} : { error: SafeErrorSchema.parse(parseJson(row.error_json)) }),
};
```

Preferred shape for complex mappers:

```ts
const commandRecord: PersistedCommand = {
  id: row.id,
  type: command.type,
  command,
  status: row.status,
  createdAt: row.created_at,
};

if (row.started_at !== null) commandRecord.startedAt = row.started_at;
if (row.finished_at !== null) commandRecord.finishedAt = row.finished_at;
if (row.trace_id !== null) commandRecord.traceId = row.trace_id;
if (row.span_id !== null) commandRecord.spanId = row.span_id;
if (row.error_json !== null) {
  commandRecord.error = SafeErrorSchema.parse(parseJson(row.error_json));
}

return commandRecord;
```

Alternative helper shape, if chosen and documented:

```ts
function setIfDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
```

Use a helper only if it improves readability. Do not introduce clever generic helpers that require more thought than the conditional spreads they replace.

Acceptance:

```text
the six hotspot files no longer use conditional spreads for dense mapper construction
small isolated conditional spreads may remain where they are clearer than a builder
exact optional semantics are preserved: absent fields stay absent
row mapper tests and graph tests still pass
```

Suggested test focus:

```text
rows with null database fields omit optional domain fields
rows with non-null database fields preserve optional domain fields
graph rows omit absent terminal/agent/orphan fields
safe error conversion still redacts and preserves context
doctor/debug output remains schema-valid
```

### P2.3 Remove Double-Evaluated Extractor Calls

Problem:

Some conditional spreads call the same extractor twice: once in the condition and once in the object. This is mostly a readability issue, but it can become a correctness issue if an extractor gains cost, state, or side effects later.

Primary files:

```text
integrations/worktree/worktrunk/src/parse.ts
integrations/terminal/tmux/src/parse.ts
apps/observer/src/diagnostics/collector.ts
```

Current smells:

```ts
...(numberField(main, "ahead") === undefined ? {} : { ahead: numberField(main, "ahead") }),
...(numberField(main, "behind") === undefined ? {} : { behind: numberField(main, "behind") }),
```

```ts
...(parsePositiveInteger(pid) === undefined ? {} : { pid: parsePositiveInteger(pid) }),
```

```ts
...(created.at(-1) === undefined ? {} : { newestCreatedAt: created.at(-1) }),
```

Direction:

Store extracted values in named locals.

Preferred shape:

```ts
const ahead = numberField(main, "ahead");
const behind = numberField(main, "behind");

const observation: WorktreeObservation = {
  ...
};

if (ahead !== undefined) observation.ahead = ahead;
if (behind !== undefined) observation.behind = behind;
```

Acceptance:

```text
no extractor call is repeated inside condition/value conditional spread pairs
Worktrunk parse tests still pass
tmux parse tests still pass
diagnostics collector tests still pass
```

### P2.4 Type Intermediate Objects Before Schema Parse In Hot Paths

Problem:

Runtime schema parsing is good at boundaries, but several hot paths construct large untyped object literals and rely on `Schema.parse` to catch shape problems. This makes TypeScript less useful during implementation.

Primary files:

```text
apps/observer/src/diagnostics/collector.ts
packages/observability/src/errors.ts
apps/observer/src/hooks/ingestion.ts
apps/observer/src/commands/queue.ts
```

Current smell:

```ts
return DoctorReportSchema.parse({
  schemaVersion: WOSM_SCHEMA_VERSION,
  generatedAt: toIsoTimestamp(clock.now()),
  status,
  checks,
  observer: snapshot.observerHealth,
  config: snapshot.configSummary,
  ...
});
```

Preferred shape:

```ts
const report: DoctorReport = {
  schemaVersion: WOSM_SCHEMA_VERSION,
  generatedAt: toIsoTimestamp(clock.now()),
  status,
  checks,
  observer: snapshot.observerHealth,
  config: snapshot.configSummary,
  ...
};

return DoctorReportSchema.parse(report);
```

Acceptance:

```text
large diagnostics and error objects are typed before schema parsing
runtime parse remains at IO/contract boundaries
TypeScript catches missing required fields before tests run
```

## 5. Convention To Add To AGENTS.md

The agent executing this plan must update `AGENTS.md` after the P1/P2 implementation establishes the final convention. Do not update `AGENTS.md` with speculative rules before the code demonstrates the chosen pattern.

At minimum, add a short convention covering these decisions:

```text
When constructing objects with optional fields under exactOptionalPropertyTypes:
- Preserve absent-vs-undefined semantics.
- Avoid dense conditional object spreads in complex mappers or boundary constructors.
- Prefer typed local builders with explicit assignments for complex objects.
- Small conditional spreads are acceptable only when the intent remains obvious.
- Do not await inside array/object spread expressions in production code; await into a named local first.
- Keep provider-specific diagnostics behind provider/integration boundaries.
- Prefer strict schemas for untrusted input; do not duplicate hand-written validators for the same payload shape.
```

The `AGENTS.md` update should also link back to this document or its successor if this plan is superseded.

Suggested `AGENTS.md` wording after implementation:

```md
## Optional Object Construction

`exactOptionalPropertyTypes` is intentional. Preserve the difference between absent optional fields and fields set to `undefined`.

For complex mappers, persistence row conversion, diagnostics construction, error shaping, and provider payload parsing, prefer typed local builders with explicit `if` assignments over dense `...(value === undefined ? {} : { value })` object spreads. Small conditional spreads are acceptable when they stay local and obvious.

Do not use `...(await somePromise)` in production array or object construction. Await into a named local first.

Provider-specific diagnostics and behavior must stay behind provider or integration boundaries. Observer/core code should aggregate provider diagnostics through contracts or injected capabilities, not import concrete providers directly.

Use strict schemas for untrusted input and shared payload formats. Avoid maintaining parallel hand-written validators for the same shape.
```

## 6. Suggested Execution Sequence

Recommended order:

```text
1. P1.1 provider boundary for Worktrunk doctor checks
2. P1.2 recovery breadcrumb schema
3. P1.3 shared breadcrumb metadata parsing
4. P1.4 diagnostics required/optional narrowing
5. P2.1 production async spread cleanup
6. P2.3 double-evaluated extractor cleanup
7. P2.2 conditional spread hotspot refactors
8. P2.4 type intermediate objects before schema parse
9. update AGENTS.md with the finalized convention
```

This order removes architecture and correctness risk before style debt.

## 7. Non-Goals

This plan does not require:

```text
rewriting all object construction
removing every conditional spread
moving all schemas to contracts
changing exactOptionalPropertyTypes
changing public protocol shapes for style reasons
converting this work into an Effect refactor
```

If a future change wants to add lint guards, add them only after the convention is implemented and written in `AGENTS.md`.
