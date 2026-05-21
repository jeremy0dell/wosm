# Test Layout

Phase 0 keeps tests in predictable locations from the first commit.

- Workspace-local unit and integration tests live under `apps/*/test`, `packages/*/test`, or `integrations/*/*/test`.
- Cross-system tests live under top-level `tests/`.
- `tests/support/` is reserved for fake providers, fake external tools, temp projects, assertions, databases, and sockets.
- `tests/agent/scripted/` contains deterministic scripted-agent tests that can run in standard CI.
- Real-agent tests are reserved for `tests/agent/real/` and are opt-in only.
- `tests/support/fake-agent/` contains helpers for launching deterministic scripted harness plans in CI.
- `tests/e2e/worktrunk-real.test.ts` is an opt-in real Worktrunk lane. Run it only with `WOSM_REAL_WORKTRUNK=1` and an installed `wt` binary, optionally setting `WOSM_WORKTRUNK_BIN=/path/to/wt`. It is intentionally not part of `test:all`.

No random floating tests should be added outside these directories.
