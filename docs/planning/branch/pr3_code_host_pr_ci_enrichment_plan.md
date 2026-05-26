# PR 3 - Code Host PR and CI Enrichment

Status: planned

Related research: `docs/planning/branch/branch_pr_ci_metadata_research.md`

## Goal

Add a provider-neutral repository/code-host enrichment boundary and a GitHub-first implementation that discovers PR metadata and aggregate CI/check state in the background, persists normalized results, and publishes snapshot updates without putting network work in hot reconcile.

This PR completes the requested row metadata: branch `+/-`, clickable PR number, and aggregate CI status.

## Non-goals

- No TUI calls to `gh`, `git`, `wt`, REST, or GraphQL.
- No synchronous remote refresh during hot reconcile.
- No `gh pr status`.
- No direct GitHub payloads in observer graph, contracts, protocol, or TUI.
- No GitLab implementation in this PR, but contracts must leave room for it.
- No detailed check panel or raw check list in the TUI.

## Product Decisions

- Use `gh` for the first GitHub implementation rather than direct REST/GraphQL.
  - It handles user auth, enterprise hosts, and standard local setup better for v1.
  - The integration still parses strict JSON into normalized contracts.
- PR matching should be conservative.
  - Prefer exact repository remote plus local head branch.
  - Use HEAD sha when available.
  - If fork/ambiguous branch matching cannot be proven, omit `pr` and record a safe diagnostic instead of guessing.
- CI row display is aggregate only.
  - `passing`, `failing`, `pending`, `skipped`, `cancelled`, `none`, `unknown`.
  - Counts may be stored and rendered compactly, but raw check names are out of scope.
- Stale cached PR/CI metadata should still render, marked stale.

## Build Scope

### Contracts

Extend `packages/contracts/src/providers.ts`:

- Add provider type `repository` or `code_host` to `ProviderTypeSchema`.
- Add `RepositoryCapabilities`.
- Add `RepositoryProvider` interface.

Suggested provider methods:

```ts
export interface RepositoryProvider {
  id: ProviderId;
  capabilities(): RepositoryCapabilities;
  health(): Promise<ProviderHealth>;
  discoverPullRequest(request: RepositoryPullRequestRequest): Promise<WorktreePullRequest | null>;
  readChecks(request: RepositoryChecksRequest): Promise<WorktreeChecksSummary | null>;
}
```

Keep request and response types provider-neutral. Provider-specific fields belong in integration-local parsing or sanitized diagnostics only.

### Provider Registry

Extend `apps/observer/src/providers/registry.ts` and factory wiring to include repository providers.

Start with a GitHub provider implementation under an integration boundary, for example:

- `integrations/repository/github`
- or `integrations/code-host/github`

The observer imports the provider through the registry. TUI and protocol clients never import it.

### GitHub Provider

Use targeted `gh` commands with strict JSON fields.

Preferred shape:

- Discover PR:
  - `gh pr view <branch-or-url> --json number,url,state,baseRefName,headRefName,headRefOid,isDraft,updatedAt`
  - or a targeted `gh pr list --head <branch> --json ...` when `view` cannot resolve safely.
- Read checks:
  - `gh pr checks <number> --json name,state,bucket,link,startedAt,completedAt`
  - or a targeted checks command on the commit/ref when no PR exists, if reliable.

Avoid broad `gh pr status`.

Normalize provider output immediately:

- PR shape maps to `WorktreePullRequest`.
- Check rollup maps to `WorktreeChecksSummary`.
- Auth, rate-limit, network, no-PR, and ambiguous-PR outcomes become typed safe states.

### Background Refresh

Remote refresh should:

- Run after hot reconcile has already published a snapshot.
- Use TTLs:
  - PR identity: about 5 minutes while branch/head is unchanged.
  - Running/pending checks: 30-60 seconds.
  - Terminal passing/failing/no-checks states: 2-5 minutes.
- Use per-host/repo concurrency limits, around 2 active requests.
- Use 2-3 second request timeout per `gh` operation.
- Back off after auth, rate-limit, and network failures.
- Trigger `worktree.updated` or snapshot refresh when normalized metadata changes.

### Observer Graph

Hot reconcile should:

- Read cached `pull_request` and `checks` rows from `worktree_metadata_current`.
- Merge valid cached metadata into `WorktreeRow.worktree`.
- Mark expired-but-usable metadata as stale only when intentionally surfaced.
- Continue producing snapshots when remote metadata is unavailable.

## Persistence Scope

Reuse the `worktree_metadata_current` table introduced in PR 2. Do not add a separate persistence PR.

PR 3 writes:

- `kind = 'pull_request'`
  - payload: `WorktreePullRequest`
  - cache key includes worktree id, remote URL or owner/repo, branch, HEAD sha when known.
  - TTL about 5 minutes when branch/head is unchanged.

- `kind = 'checks'`
  - payload: `WorktreeChecksSummary`
  - cache key includes PR number or commit sha, host/repo, branch, and HEAD sha.
  - TTL varies by aggregate state.

Use `last_error_json` for safe, redacted refresh failures. Do not store raw `gh` stdout/stderr except in bounded diagnostics if the existing diagnostics policy permits it.

Optionally record repository provider observations for debug bundle evidence, but do not use historical provider observations for hot snapshot reads.

## Test Pack

Write tests before implementation.

- Contract tests:
  - `ProviderTypeSchema` accepts the new repository/code-host provider type.
  - Repository provider requests/responses parse.
  - Raw GitHub `statusCheckRollup` shape is rejected by snapshot schemas.

- GitHub provider unit tests with fake command runner:
  - Parses PR JSON into `WorktreePullRequest`.
  - Parses check JSON buckets into aggregate `WorktreeChecksSummary`.
  - Handles no PR found as `null`, not provider failure.
  - Handles auth/network/rate-limit failures as typed safe errors with backoff metadata.
  - Does not call `gh pr status`.

- Persistence tests:
  - Upserts `pull_request` and `checks` metadata kinds.
  - TTL filtering works separately for PR and checks rows.
  - Safe last-error state is stored without raw secrets.

- Observer integration tests:
  - Cached PR/checks metadata appears in snapshots.
  - Stale cached metadata can be surfaced with `stale: true`.
  - Remote refresh failure does not fail reconcile.
  - Provider health reports degraded/unavailable states for auth or command failures.

- TUI tests:
  - `#123` renders from normalized `pr`.
  - CI aggregate marker renders from normalized `checks`.
  - TUI import-boundary test still passes.

## Red-First Expectations

Before implementation:

- Provider contracts cannot represent repository/code-host providers.
- Provider registry cannot hold repository providers.
- No GitHub provider exists.
- `pull_request` and `checks` cache kinds are unused.
- Snapshot rows cannot be refreshed from remote metadata.

## Acceptance Criteria

- Hot reconcile has no network calls and no `gh` calls.
- GitHub PR/CI refresh happens only in background enrichment.
- Cached PR and checks metadata appear in snapshots and TUI rows.
- Remote failures degrade metadata/provider health without breaking worktree rows.
- Raw GitHub response shapes do not cross provider boundaries.
- Persistence from PR 2 is reused for remote metadata.
- `pnpm test --filter @wosm/contracts`
- `pnpm test --filter @wosm/observer`
- `pnpm test --filter @wosm/tui`
- GitHub provider package tests with fake runner.

## Risks

- Risk: `gh` behavior varies by host/auth state.
  Mitigation: Treat auth and network failures as normal provider states and keep cached data usable.

- Risk: Fork PR matching is ambiguous.
  Mitigation: Omit metadata unless repository, branch, and/or HEAD sha match confidently.

- Risk: Remote refresh becomes noisy or rate limited.
  Mitigation: TTLs, per-host concurrency, and exponential backoff are required acceptance criteria.

- Risk: Provider-specific data leaks into TUI.
  Mitigation: Enforce existing TUI import-boundary tests and add snapshot-schema tests that reject raw GitHub payloads.
