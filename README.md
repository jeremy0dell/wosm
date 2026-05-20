# wosm

wosm is in Phase 0: repository, tooling, and test skeleton only.

The architectural reference is [docs/planning/wosm_rebuild_tdd_final_v1.md](docs/planning/wosm_rebuild_tdd_final_v1.md). Use it for architecture, contracts, ownership boundaries, observability, and testing strategy.

The implementation sequence is [docs/planning/wosm_phased_development_cycle_final_v1.md](docs/planning/wosm_phased_development_cycle_final_v1.md). Current work is limited to Phase 0 from that plan.

Phase 0 intentionally does not include real observer, TUI, provider, Worktrunk, tmux, Codex, or OpenCode behavior.

## Phase 0 Commands

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:contracts
pnpm test:integration
pnpm test:agent:scripted
pnpm test:all
```
