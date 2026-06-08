# CI Lane Evolution Plan

## Current Standard Lane

`standard-ci` is the normal deterministic GitHub Actions workflow for pull
requests and `main` pushes. It should stay focused on checks that are stable on
a clean hosted runner:

- frozen `pnpm install`
- build
- typecheck
- lint
- unit tests
- contract tests
- integration tests
- diagnostic tests
- deterministic scripted-agent tests

This lane must not require real Worktrunk, tmux, Codex, OpenCode, model access,
developer terminal state, user repositories, or provider credentials.

## Manual Or Scheduled Release Smoke

Add a separate manual or scheduled lane for `pnpm smoke:release` once the release
process needs hosted evidence beyond local runs.

Recommended trigger:

- `workflow_dispatch` for release preparation
- optional low-frequency `schedule` after the lane has proven stable

This lane should remain fake-provider and scripted. It can be allowed to take
longer than `standard-ci`, but it should not depend on real provider CLIs or
credentials.

## Optional Fake-Provider E2E Lane

`pnpm test:e2e` can become an extended deterministic lane when PR feedback needs
broader CLI/protocol coverage.

Recommended trigger:

- `workflow_dispatch` at first
- optional scheduled run if runtime stays stable
- optional PR label or path-filtered trigger later

Keep this lane fake-provider only. It can share artifacts such as logs,
diagnostics, and debug bundles for failures.

## Real Provider E2E Lanes

Real Worktrunk, tmux, Codex, OpenCode, and product real E2E lanes must stay out
of normal PR and `main` CI.

Allowed trigger shapes:

- `workflow_dispatch` on a prepared self-hosted runner
- scheduled run on an isolated machine owned for real E2E
- explicit local command from a release checklist

Required guardrails:

- require explicit `WOSM_REAL_*` flags
- use isolated temp projects and state directories
- avoid active user repositories by default
- collect redacted diagnostics and debug bundles on failure
- clean up real terminal/provider state after each run
- never block standard PR or `main` CI

## Docs-Only Lightweight Workflow

A docs-only workflow can be added later if documentation churn makes full
`standard-ci` wasteful for narrow doc changes.

Possible checks:

- markdown formatting or linting if the repo adopts a formatter
- link checks for local docs
- spelling or terminology checks if maintained centrally

Do not introduce docs-only filtering until it clearly saves time. The default
policy remains that `standard-ci` runs for all pull requests and `main` pushes.

## Promotion Rule

Promote a check into `standard-ci` only when it is deterministic on a clean
hosted runner and does not require real providers, credentials, model behavior,
network access beyond dependency installation, local terminal state, or user
repositories. Real-provider lanes may provide release confidence, but they must
not become required for ordinary pull requests or `main` pushes.
