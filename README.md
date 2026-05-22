# wosm

wosm is in rebuild. Phase 11.5 provides the first narrow manual smoke path: build the repo, run the CLI, start or connect to the observer, reconcile configured projects through Worktrunk, inspect a JSON snapshot, and open the current TUI shell.

The architectural reference is [docs/planning/wosm_rebuild_tdd_final_v1.md](docs/planning/wosm_rebuild_tdd_final_v1.md). Use it for architecture, contracts, ownership boundaries, observability, and testing strategy.

The implementation sequence is [docs/planning/wosm_phased_development_cycle_final_v1.md](docs/planning/wosm_phased_development_cycle_final_v1.md).

Manual smoke instructions are in [docs/manual-smoke.md](docs/manual-smoke.md).

External provider dependencies are listed in [docs/system-dependencies.md](docs/system-dependencies.md). For the current real Worktrunk path, use the repo `Brewfile` or install `worktrunk` so `wt --version` succeeds before manual TUI testing.

## Commands

```sh
pnpm install
pnpm setup:system:check
pnpm setup:system --yes
pnpm build
pnpm wosm doctor
pnpm wosm reconcile --reason manual-smoke
pnpm wosm snapshot --json
pnpm wosm
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:contracts
pnpm test:integration
pnpm test:agent:scripted
pnpm test:all
```
