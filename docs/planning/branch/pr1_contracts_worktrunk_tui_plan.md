# PR 1 - Branch Metadata Contracts, Worktrunk Parser, and TUI Row

Status: planned

Related research: `docs/planning/branch/branch_pr_ci_metadata_research.md`

## Goal

Create the normalized metadata surface that later PRs can populate, fix the known Worktrunk parsing gap for modern `working_tree` output, and render available metadata from snapshots without adding any new IO to the TUI.

This PR should make the product shape visible and testable without introducing background refresh, GitHub calls, or local git enrichment.

## Non-goals

- No `gh`, REST, GraphQL, or network access.
- No `wt list --full`.
- No local `git diff --numstat` enrichment.
- No repository/code-host provider type yet.
- No new current-state metadata cache table beyond existing observation persistence.
- No TUI commands to open or copy PR URLs.

## Product Decisions

- Row LOC should eventually mean branch diff against a base ref, not uncommitted working tree diff and not GitHub PR diff. PR 2 will populate it.
- Worktrunk `working_tree.diff` is useful local evidence but should not be mislabeled as branch diff. In this PR it may be preserved as provider-local parsed data or mapped only to a clearly named normalized working-tree summary if the contract includes one.
- PR links render as `#123` when `worktree.pr` exists. If OSC 8 support is available in the local rendering helper, `pr.url` can be used; otherwise plain text is acceptable.
- CI renders only aggregate state from normalized `worktree.checks` once available. No raw provider names or raw check payloads appear in the row.

## Build Scope

### Contracts

Extend `packages/contracts/src/observations.ts` and `packages/contracts/src/snapshot.ts` with provider-neutral schemas:

- `WorktreePullRequest`
  - `number`
  - `url?`
  - `host?`
  - `state?`: `open | closed | merged | draft | unknown`
  - `baseRef?`
  - `headRef?`
  - `updatedAt?`
  - `checkedAt?`
  - `stale?`

- `WorktreeChangeSummary`
  - `kind`: `branch_diff`
  - `additions`
  - `deletions`
  - `changedFiles?`
  - `binaryFiles?`
  - `baseRef?`
  - `baseSha?`
  - `headSha?`
  - `source`: `local_git | worktrunk | code_host`
  - `checkedAt`
  - `stale?`

- `WorktreeChecksSummary`
  - `state`: `passing | failing | pending | skipped | cancelled | none | unknown`
  - `url?`
  - `total?`
  - `passing?`
  - `failing?`
  - `pending?`
  - `source`: `code_host | worktrunk_cache`
  - `checkedAt`
  - `stale?`
  - `reason?`

Add optional fields to `WorktreeObservation` and `WorktreeRuntime`:

- `changeSummary?`
- `checks?`

Preserve `exactOptionalPropertyTypes`: optional fields must be absent when unknown, not present with `undefined`.

### Worktrunk Parser

Update `integrations/worktree/worktrunk/src/parse.ts` to understand current Worktrunk JSON:

- Read dirty state from `working_tree` as well as current supported shapes.
- Parse `working_tree.diff.added` and `working_tree.diff.deleted` into a small provider-local helper or normalized working-tree summary if the contract includes one.
- Keep `main.ahead` and `main.behind` mapping unchanged.
- Keep raw Worktrunk details inside Worktrunk integration code or sanitized `providerData`; do not expose Worktrunk-shaped `ci` or `main.diff` directly as core contract fields.

### Observer Graph

Update `apps/observer/src/reconcile/graph.ts` to explicitly copy new optional normalized fields from `WorktreeObservation` into `WorktreeRow.worktree`.

Use local builder style:

```ts
const worktree: WorktreeRow["worktree"] = {
  state: input.worktree.state,
  source: input.worktree.source,
};
if (input.worktree.changeSummary !== undefined) worktree.changeSummary = input.worktree.changeSummary;
if (input.worktree.checks !== undefined) worktree.checks = input.worktree.checks;
```

Avoid dense optional spreads for this mapper.

### TUI

Update `apps/tui/src/components/WorktreeRow.tsx` to render compact normalized metadata:

- Branch name remains the main row identity.
- `changeSummary` renders as `+N/-N`.
- `pr` renders as `#N`.
- `checks` renders as a short aggregate marker, for example `ci:pass`, `ci:fail`, `ci:run`, `ci:none`, or `ci:?`.
- Stale metadata should be visually quiet, such as dim text or a suffix, but not a warning by default.

The TUI must not import provider packages and must not call `wt`, `git`, `gh`, or network APIs.

## Persistence Scope

No dedicated metadata cache is added in PR 1.

Existing persistence already records provider observations during reconcile. That is enough for this PR because Worktrunk parser output arrives through `WorktreeObservation` and is part of the normal reconcile payload. Do not extend the hot-path persistence model yet.

PR 2 creates the dedicated current-state table for enrichment cache entries, and PR 3 reuses it for PR and CI data.

## Test Pack

Write tests before implementation.

- Contract schema tests:
  - Valid snapshot fixture with `changeSummary`, `pr`, and `checks` parses.
  - Invalid raw provider-shaped check payload fails.
  - Optional fields are absent when unknown.

- Observer graph tests:
  - `buildWosmSnapshot` copies normalized metadata into `WorktreeRow.worktree`.
  - Missing metadata is omitted.

- Worktrunk parser tests:
  - Fixture with `working_tree.dirty` or equivalent current dirty signal marks the observation dirty.
  - Fixture with `working_tree.diff.added/deleted` is parsed without confusing it with branch diff.
  - Existing old fixture shape still passes.

- TUI tests:
  - Row renders branch, PR number, branch diff summary when present, and aggregate CI state when present.
  - Row rendering remains snapshot-only.
  - Existing import-boundary test still rejects provider imports and debug/provider raw strings.

## Red-First Expectations

Before implementation:

- Contract fixtures with new metadata fields fail schema validation.
- Observer graph does not copy new fields.
- Worktrunk parser misses `working_tree` dirty/diff.
- TUI row does not show metadata.

## Acceptance Criteria

- Contracts expose normalized metadata fields without raw GitHub, Worktrunk, or CI-provider payloads.
- Worktrunk parser handles modern `working_tree` dirty state.
- TUI can display metadata already present in snapshots.
- TUI still has no provider imports and no provider IO.
- No network or `wt list --full` behavior is introduced.
- `pnpm test --filter @wosm/contracts`
- `pnpm test --filter @wosm/worktrunk`
- `pnpm test --filter @wosm/observer`
- `pnpm test --filter @wosm/tui`

## Risks

- Risk: Working-tree diff is mistaken for branch diff.
  Mitigation: Keep row LOC reserved for `kind: branch_diff`; do not populate it from `working_tree.diff`.

- Risk: Contract grows with provider-specific names.
  Mitigation: Only add provider-neutral states and source enums.

- Risk: TUI row gets cluttered.
  Mitigation: Render compact text only and keep detailed diagnostics for later CLI/debug surfaces.
