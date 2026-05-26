# Branch PR CI Metadata Research

Research date: 2026-05-26

Scope: show per-worktree branch metadata in the TUI: line additions/deletions, a clickable PR number, and CI/check status.

## Current State

### Existing contract fields

`packages/contracts/src/observations.ts` already defines `WorktreeObservation.dirty`, `ahead`, `behind`, and `pr`. The `pr` shape is currently only `{ number, url? }`, so it can display a PR number/link but cannot represent host, base/head refs, PR state, stale status, or check state.

`packages/contracts/src/snapshot.ts` carries the same fields into `WorktreeRuntime`: `dirty`, `ahead`, `behind`, and `pr`. There is no contract field today for branch line additions/deletions, remote tracking branch, check/CI state, stale metadata, or metadata refresh timestamps.

`packages/contracts/src/providers.ts` only has provider types for `worktree`, `terminal`, and `harness`. Worktree capabilities include `canExposeDirtyState`, but there is no capability for local diff stats, remote PR discovery, or CI/check discovery.

### Current observer-to-TUI data flow

The observer is the only place current provider truth is combined. `apps/observer/src/reconcile/run.ts` runs worktree provider listing, terminal listing, and harness discovery/classification, then calls `buildWosmSnapshot`. `apps/observer/src/reconcile/graph.ts` copies optional worktree metadata from `WorktreeObservation` into `WorktreeRow.worktree`, preserving absence for unknown optional fields.

The TUI consumes observer snapshots/events through `apps/tui/src/services/observerService.ts`. `apps/tui/src/eventReducer.ts` can apply `worktree.updated` patches directly, and it refreshes snapshots after `observer.reconciled` and `provider.healthChanged`. `apps/tui/src/components/WorktreeRow.tsx` currently renders only slot, status marker, branch, harness, agent status label, terminal, and warning reason. It does not render `dirty`, `ahead`, `behind`, `pr`, diff stats, or CI.

This means the correct rendering path is already available: add normalized row metadata to contracts and observer graph output, then render it in `WorktreeRow`. The TUI should not call `wt`, `git`, `gh`, or network APIs.

### Current Worktrunk parsing behavior

`integrations/worktree/worktrunk/src/provider.ts` calls:

```sh
wt list --format=json
```

per configured project, then parses the result through `parseWorktrunkListJson`.

The current parser reads:

- `path` / `worktree_path`
- branch name or detached commit-derived label
- `main.ahead` and `main.behind`
- dirty state from top-level `dirty`, `git.dirty`, or numeric fields under `worktree`
- provider-native wosm metadata from `vars.wosm` / `vars.WOSM_*`

The installed Worktrunk 0.53.0 JSON output uses `working_tree` for dirty flags and uncommitted diff stats, not the older `worktree.modified` fixture shape. So current wosm can miss dirty state and `working_tree.diff` from modern Worktrunk output. The parser also ignores documented `remote`, `main.diff`, and `ci` objects.

## Available Data Sources

### Worktrunk-provided local metadata

Local evidence:

- `wt --version`: `wt 0.53.0`
- `wt list -h`: supports `--format <FORMAT>`, `--branches`, `--remotes`, `--full`, and `--progressive`
- `wt list --help`: panicked locally with `capacity overflow`; `-h` worked
- `wt list --format=json`: returned branch, path, commit, `working_tree`, `main`, `remote`, `worktree`, `main_state`, `statusline`, and `symbols`
- timed local `wt list --format=json`: about `0.12s` for six worktrees in this repo, with sandbox-related warnings from git temp-file creation in other worktrees
- `wt config state ci-status get --format=json`: returned cached CI state shape `{ status, source, stale }`

Official docs: https://worktrunk.dev/list/

Coverage:

- Dirty state: yes, documented under JSON `working_tree`.
- Uncommitted line stats: yes, `working_tree.diff.{added,deleted}`.
- Ahead/behind default branch: yes, `main.{ahead,behind}`.
- Remote tracking ahead/behind: yes, `remote.{name,branch,ahead,behind}`.
- Branch line diff since merge-base: yes, but documented as `main.diff` and tied to `--full`.
- CI/check status: yes, but documented under `--full` as `ci.{status,source,stale,url}`.
- PR/MR link: partial. CI indicators link to PR/MR or pipeline pages, and `ci.url` is documented, but no separate PR number field is documented in `wt list` JSON.
- Base branch: indirectly through `main` and Worktrunk default-branch state, but `wt list` JSON uses the compact `main` field name.

Limitations:

- `--full` adds data that can require network access and LLM calls. It is not appropriate for hot reconcile.
- Worktrunk caches CI and git command results under `.git/wt/cache`; `wt list` is not a purely stateless read.
- CI status requires `gh` or `glab` authenticated according to Worktrunk config docs: https://worktrunk.dev/config/#wt-config-state-ci-status
- Worktrunk owns worktree lifecycle truth, but its CI data model is Worktrunk-shaped. wosm should normalize it before snapshot publication.

### Raw git local metadata

Local commands checked:

- `git status --porcelain=v2 --branch`
- `git merge-base main HEAD`
- `git diff --numstat main...HEAD`
- `git remote -v`
- `git symbolic-ref refs/remotes/origin/HEAD`
- upstream discovery via `@{upstream}`

Findings:

- `git status --porcelain=v2 --branch` is cheap for one worktree here, about `0.02s`, and exposes branch/head/upstream/ahead-behind when upstream exists.
- Current branch `pr-info-1` has no upstream configured, so `@{upstream}` fails and status has no upstream ahead/behind.
- `origin/HEAD` points to `origin/main`, so default remote base can be found locally without a fetch.
- `git diff --numstat main...HEAD` is cheap here, about `0.01s`, and returns per-file additions/deletions since merge-base. It returned no lines because this branch is currently at the same commit as `main`.

Coverage:

- Dirty state: yes through porcelain status, but line counts require extra diff calls.
- Branch diff stats: yes with `git diff --numstat <base>...HEAD`.
- Base branch: local discovery can use project config, Worktrunk base/default branch, `refs/remotes/<remote>/HEAD`, or branch upstream. Network fetch should be separate.
- PR and CI: no.

Limitations:

- Many worktrees multiply cost. Even cheap 10-30 ms calls become visible when run per row on each reconcile.
- Correct base selection is a policy decision: project default branch, Worktrunk base, upstream merge target, or PR base can differ.
- `--numstat` binary files report `-`, so the normalized contract needs either numeric totals only when parseable or an explicit unknown/binary count.
- Without `git fetch`, remote/upstream freshness is intentionally stale.

### GitHub CLI and GitHub API remote metadata

Local evidence:

- `gh --version`: `2.86.0`
- `gh auth status`: authenticated for `github.com`
- `gh pr view --json ...` on `pr-info-1`: no PR found for this branch
- `gh pr status --json ...`: failed to connect to `api.github.com` in this sandboxed run
- `gh pr view --help` and official manual list fields including `number`, `url`, `baseRefName`, `headRefName`, `headRefOid`, `additions`, `deletions`, `changedFiles`, and `statusCheckRollup`
- `gh pr checks --help` and official manual expose per-check JSON fields and a `bucket` field mapping check states to pass/fail/pending/skipping/cancel buckets

Official docs:

- `gh pr view`: https://cli.github.com/manual/gh_pr_view
- `gh pr checks`: https://cli.github.com/manual/gh_pr_checks
- `gh api`: https://cli.github.com/manual/gh_api
- Pull request REST listing supports filtering by head/base: https://docs.github.com/en/rest/pulls/pulls
- Checks REST API lists check runs for a ref: https://docs.github.com/en/rest/checks/runs
- Commit statuses REST API exposes combined commit status: https://docs.github.com/en/rest/commits/statuses

Coverage:

- PR number/link: yes via `gh pr view`, `gh pr list`, REST pulls, or GraphQL.
- PR base/head refs and state: yes.
- PR additions/deletions: yes via `gh pr view --json additions,deletions`, but this is host-computed PR diff, not necessarily the same as local `git diff <base>...HEAD`.
- CI/check state: yes via `gh pr checks`, `statusCheckRollup`, REST check-runs, and REST commit statuses.
- Branch-only CI without PR: yes via checks/status APIs on a commit/ref, but exact behavior depends on workflows and pushed commits.

Limitations:

- Network, auth, rate limits, enterprise hosts, and outages are normal failure modes.
- `gh pr status` is broad and can be slower or fail even when local rows should still render.
- `statusCheckRollup` is convenient through GraphQL/`gh`, but the raw shape is GitHub-specific and should not leak into observer core or TUI.
- GitHub-first is practical, but the contract should be host-neutral so GitLab/other forges can be added later.

## Performance Constraints

Safe in hot reconcile:

- Existing `wt list --format=json` calls, with the current provider timeout/retry boundary.
- Parsing Worktrunk local fields already present in the list payload.
- Reading cached enrichment state from observer-owned memory/SQLite.
- Optional local git diff only if bounded by cache keys, timeout, and concurrency.

Not safe in hot reconcile:

- `wt list --full`, because it may do network work and LLM summaries.
- `gh pr status`, `gh pr view`, `gh pr checks`, `gh api`, GraphQL, REST, or any fetch.
- Host auth checks and rate-limit probes.
- Any remote metadata refresh for every worktree synchronously before returning a snapshot.

Recommended budgets:

- Local git fallback: cache by `(worktree path, HEAD sha, base ref/sha, index/worktree dirty signature)`, timeout 100-250 ms per worktree, concurrency 2-4 per repo, overall local enrichment budget near 1s.
- Remote PR identity: TTL 5 minutes when branch/head has not changed; invalidate on branch/head/remote changes.
- Remote CI/check state: TTL 30-60 seconds for active/running states, 2-5 minutes for terminal pass/fail/no-checks states, and refresh on explicit user refresh or post-push/worktree hook signals.
- Remote calls: timeout 2-3 seconds per request, concurrency 2 per host/repo, exponential backoff after auth/rate-limit/network failures.
- Stale behavior: publish stale cached metadata with `stale: true` and `checkedAt`; omit unknown fields entirely when there is no usable value.

## Top Implementation Options

### 1. Hybrid Worktrunk/local-git plus repository metadata provider

Use Worktrunk for worktree identity, lifecycle, path, branch, dirty, ahead/behind, and any cheap local metadata it exposes. Add bounded local git fallback for branch diff stats when Worktrunk does not expose them without `--full`. Add a new host-neutral repository/code-host enrichment provider for PR and CI metadata, with GitHub as the first implementation.

Fit: best. Keeps TUI provider-neutral and snapshot-driven, keeps Worktrunk primary for worktree truth, avoids network in hot reconcile, and leaves room for GitHub first without hardcoding GitHub into observer core.

Performance: best if the observer reads cached remote metadata in hot reconcile and refreshes PR/CI in the background.

Complexity: medium-high. Requires new contracts, cache/persistence, provider health, and tests.

Extensibility: high. GitHub, GitLab, and Worktrunk-derived CI can all normalize into the same row metadata later.

Rank: 1, recommended default path.

### 2. Observer-local enrichment helper as a prototype path

Build an observer-owned `repositoryMetadata` helper that runs local git and GitHub CLI/API behind an internal interface, caches results, and merges normalized fields into snapshots. Extract it to a formal provider once behavior and UI needs settle.

Fit: good if the helper is isolated and returns provider-neutral data. Risky if GitHub/`gh` logic spreads through observer core.

Performance: good with the same stale-while-revalidate cache rules as option 1.

Complexity: medium. Faster to land than a new provider type, but creates extraction debt.

Extensibility: medium. Acceptable as a short-lived prototype only if tests enforce no TUI provider calls and no raw GitHub payloads in snapshots.

Rank: 2, acceptable first slice if scope is tightly contained.

### 3. Worktrunk plus local git diff only

Keep Worktrunk as-is for identity and local state, fix the parser for current `working_tree`, and compute `+N/-N` branch diff with local `git diff --numstat <base>...HEAD`.

Fit: good for local-first metadata and architecture boundaries.

Performance: good with bounded local git. No network needed.

Complexity: low-medium.

Extensibility: limited. Does not solve PR link or CI/check status.

Rank: 3, good incremental step for LOC stats, incomplete for the requested full feature.

### 4. Worktrunk-only/local-first, including `wt list --full`

Rely on Worktrunk for local metadata, `main.diff`, and CI status by running `wt list --full --format=json` or by reading Worktrunk CI cache.

Fit: mixed. Worktrunk does expose much of the desired data, but `--full` adds network/LLM behavior to the worktree provider path and imports Worktrunk's CI model directly into wosm normalization.

Performance: risky in hot reconcile. Viable only as a background source, not the default worktree listing path.

Complexity: low initial implementation, higher long-term debugging and portability cost.

Extensibility: medium-low. Worktrunk already supports GitHub/GitLab CI, but wosm would be constrained by Worktrunk's fields and cache semantics. The documented JSON has `ci.url` but no separate PR number.

Rank: 4.

### 5. TUI-direct fetching

Let `WorktreeRow` or TUI services run `git`, `gh`, `wt`, or network calls directly.

Fit: poor. This violates the project boundary that the TUI is a snapshot/event client and must not call providers.

Performance: poor. Rendering would become coupled to IO, auth, network, and rate limits.

Complexity: deceptively low initially, high once cancellation, caching, failures, and tests are required.

Extensibility: poor.

Rank: 5, explicitly rejected.

## Recommended Path

Use option 1 as the target architecture, with option 2 only as a narrow prototype if the first implementation needs to land before a formal provider type exists.

Hot reconcile should:

- Call `wt list --format=json` through the Worktrunk provider.
- Update the Worktrunk parser for current `working_tree` JSON, including dirty state and `working_tree.diff`.
- Continue mapping `main.ahead` and `main.behind` to existing `ahead` and `behind`.
- Read cached repository enrichment from observer-owned state.
- Build and publish snapshots quickly even when remote metadata is absent or stale.

Background enrichment should:

- Compute branch diff stats with local git if Worktrunk does not expose the desired branch diff without `--full`.
- Discover PR identity and URL through a repository/code-host provider.
- Refresh CI/check status through the same enrichment provider.
- Persist normalized metadata with TTLs, timeout/backoff state, and provider health.
- Publish snapshot updates or `worktree.updated` events when refreshed metadata changes.

Contracts need extension at the normalized row-metadata level, not with raw GitHub payloads. Conceptually:

- Keep existing `worktree.pr` for the minimal PR number/link, or extend it provider-neutrally with `provider`, `state`, `baseRef`, `headRef`, and `updatedAt`.
- Add a `worktree.diff` or `worktree.changeSummary` object for additions/deletions, base ref, source, computed time, and stale flag.
- Add a `worktree.checks` or `worktree.ci` object for aggregate state, URL, source, stale flag, checked time, and safe reason.
- If a formal provider is added, extend provider contracts with a `repository` or `codeHost` provider type rather than folding host API behavior into `WorktreeProvider`.

For `exactOptionalPropertyTypes`, unknown metadata should be absent. Do not set optional fields to `undefined`; builders should add optional fields only when values are known.

TUI rendering should remain simple:

- Render `#123` as a hyperlink when `pr.url` is present and the terminal supports OSC 8; otherwise render plain `#123`.
- Render compact diff stats from normalized `changeSummary`.
- Render aggregate check state from normalized `checks`.
- Do not render raw provider names unless they are part of the normalized contract.

## Open Questions

Product decisions:

- Which LOC metric should the row show: uncommitted `HEAD+/-`, branch diff since merge-base, PR diff as computed by GitHub, or more than one?
- Should CI show aggregate state only, required-check state, or a compact count of failing/running checks?
- How visible should stale metadata be in a dense row: dimmed marker, timestamp in a detail view later, or warning only on errors?
- Should clickability mean terminal OSC 8 hyperlink only, or should there also be a keyboard command to open/copy the PR URL?

Technical unknowns:

- Does Worktrunk expose a stable PR number field in source or future JSON, or only `ci.url` today?
- Should remote metadata persistence reuse `provider_observations` with a new entity kind, or get a dedicated current-state table for faster cache reads?
- Should the first GitHub implementation shell out to `gh` for auth/enterprise handling, or call REST/GraphQL directly with tokens from `gh auth token` / environment?
- How should fork PRs and branches without upstreams be matched when local branch name alone is ambiguous?

## Sources

Local files:

- `docs/planning/wosm_rebuild_tdd_final_v1.md`
- `docs/planning/wosm_phased_development_cycle_final_v1.md`
- `packages/contracts/src/observations.ts`
- `packages/contracts/src/providers.ts`
- `packages/contracts/src/snapshot.ts`
- `apps/observer/src/reconcile/run.ts`
- `apps/observer/src/reconcile/graph.ts`
- `apps/tui/src/components/WorktreeRow.tsx`
- `integrations/worktree/worktrunk/src/provider.ts`
- `integrations/worktree/worktrunk/src/parse.ts`

External primary/current sources:

- Worktrunk `wt list`: https://worktrunk.dev/list/
- Worktrunk config state and CI cache: https://worktrunk.dev/config/#wt-config-state-ci-status
- Worktrunk FAQ on cache/log files and external commands: https://worktrunk.dev/faq/
- Worktrunk GitHub README: https://github.com/max-sixty/worktrunk
- GitHub CLI `gh pr view`: https://cli.github.com/manual/gh_pr_view
- GitHub CLI `gh pr checks`: https://cli.github.com/manual/gh_pr_checks
- GitHub CLI `gh api`: https://cli.github.com/manual/gh_api
- GitHub REST pulls: https://docs.github.com/en/rest/pulls/pulls
- GitHub REST check runs: https://docs.github.com/en/rest/checks/runs
- GitHub REST commit statuses: https://docs.github.com/en/rest/commits/statuses
