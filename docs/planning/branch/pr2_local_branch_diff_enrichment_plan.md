# PR 2 - Local Branch Diff Enrichment and Current-State Cache

Status: completed planning record; current code and tests are authoritative.

Related research: `docs/planning/branch/branch_pr_ci_metadata_research.md`

## Goal

Populate `worktree.changeSummary` with local branch diff stats using bounded local git commands, and add the observer-owned current-state persistence needed for both local metadata and the later PR/CI refresh path.

This PR turns the row `+N/-N` metadata into real data while keeping hot reconcile fast and network-free.

## Non-goals

- No GitHub, GitLab, `gh`, `glab`, REST, GraphQL, or network calls.
- No `git fetch`.
- No PR discovery.
- No CI/check discovery.
- No repository/code-host provider type yet.
- No TUI behavior beyond rendering metadata already added in PR 1.

## Product Decisions

- `worktree.changeSummary` means local branch diff since merge-base against the selected base.
- Base selection order:
  1. Known PR base, when later available from cache.
  2. Project `defaultBranch`, if configured.
  3. Worktrunk project base.
  4. Remote default branch from `refs/remotes/<remote>/HEAD`.
  5. Local `main` or `master` fallback only when the ref exists.
- No fetch means freshness is local by design. The summary should be marked stale only when the cache is expired or the cache key no longer matches, not merely because remotes may be old.
- Binary file `--numstat` entries count toward `binaryFiles` and do not force additions/deletions to become unknown.

## Build Scope

### Local Git Enrichment

Add an observer-side enrichment module, for example `apps/observer/src/repositoryMetadata/localGit.ts`.

The module should:

- Resolve HEAD sha for each worktree.
- Resolve base ref and base sha without network.
- Compute additions/deletions with `git diff --numstat <base>...HEAD`.
- Count changed files and binary files.
- Bound command runtime with 100-250 ms per worktree by default.
- Limit concurrency to a small number, such as 2-4 per repository.
- Return normalized `WorktreeChangeSummary`.

Use structured command helpers and typed errors. Do not parse raw stdout outside this module.

### Observer Integration

Hot reconcile should:

- Continue listing Worktrunk, terminal, and harness providers as before.
- Read current cached metadata from SQLite.
- Merge valid cached `changeSummary` into `WorktreeObservation` or directly into the graph input.
- Return a snapshot even if enrichment has never run or failed.

Background enrichment should:

- Run after reconcile or through the reconcile scheduler without blocking snapshot publication.
- Refresh cache entries whose cache key is missing, changed, or expired.
- Publish a `worktree.updated` event or trigger a lightweight snapshot refresh when metadata changes.
- Back off on repeated local git failures per worktree.

### Cache Keys

The local cache key should include:

- `projectId`
- `worktreeId`
- normalized worktree path
- branch
- HEAD sha
- base ref
- base sha
- dirty/index signature when needed to keep local diff behavior honest

Do not use only branch name as the key.

## Persistence Scope

Add the current-state persistence now. There should not be a separate PR 4 for persistence.

Add a migration for a current-state table shaped around one row per worktree and metadata kind, for example:

```sql
CREATE TABLE IF NOT EXISTS worktree_metadata_current (
  worktree_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  expires_at TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  last_error_json TEXT,
  PRIMARY KEY (worktree_id, kind)
);
```

Expected `kind` values:

- `change_summary`
- `pull_request`
- `checks`

PR 2 only writes and reads `change_summary`. PR 3 uses the same table for `pull_request` and `checks`.

Add persistence methods:

- `upsertWorktreeMetadataCurrent`
- `listWorktreeMetadataCurrent`
- `deleteWorktreeMetadataCurrent`
- `pruneExpiredWorktreeMetadataCurrent`

Provider observations may still be recorded for debug evidence, but hot snapshot reads should use `worktree_metadata_current`, not a history scan over `provider_observations`.

## Test Pack

Write tests before implementation.

- Local git parser/unit tests:
  - Parses `git diff --numstat` additions/deletions.
  - Counts binary files where numstat reports `-`.
  - Rejects malformed output through typed safe errors.

- Base resolution tests:
  - Uses configured default branch when available.
  - Falls back to Worktrunk base.
  - Falls back to remote HEAD without fetch.
  - Omits metadata when no base can be resolved.

- Persistence tests:
  - Migration creates `worktree_metadata_current`.
  - Upsert replaces the current row for `(worktree_id, kind)`.
  - Expired entries are omitted unless explicitly requested.
  - `change_summary`, `pull_request`, and `checks` kinds are accepted, even though only `change_summary` is populated in this PR.

- Observer integration tests:
  - Snapshot includes cached `changeSummary`.
  - Reconcile succeeds when enrichment cache is empty.
  - Failed local git enrichment records safe error state without failing hot reconcile.
  - Metadata refresh emits `worktree.updated` or causes snapshot refresh.

## Red-First Expectations

Before implementation:

- Persistence methods and migration do not exist.
- Cached `changeSummary` cannot be merged into snapshots.
- Local git diff parser does not exist.
- Enrichment failures cannot be represented independently from provider health.

## Acceptance Criteria

- Hot reconcile reads cached metadata only and remains network-free.
- Local branch diff refresh runs out of band with timeout and concurrency limits.
- `worktree.changeSummary` appears for worktrees with resolvable base refs.
- Missing, stale, or failed enrichment never blocks the dashboard.
- Current-state metadata persistence exists and is ready for PR/CI metadata in PR 3.
- `provider_observations` is not used as the hot current-state cache.
- `pnpm test --filter @wosm/observer`
- `pnpm test --filter @wosm/contracts`

## Risks

- Risk: Local git calls make reconcile visibly slower.
  Mitigation: Reconcile reads SQLite cache only; local git runs in background.

- Risk: Base selection surprises users.
  Mitigation: Include `baseRef`, `baseSha`, and `source` in the summary and keep the algorithm deterministic.

- Risk: Cache invalidation is too weak.
  Mitigation: Cache by HEAD/base/path/branch, not by branch alone.

- Risk: Persistence becomes a dumping ground.
  Mitigation: Store strict normalized payloads by metadata kind and validate before writing.
