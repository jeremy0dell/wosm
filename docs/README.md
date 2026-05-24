# wosm Planning Docs

Use `planning/wosm_rebuild_tdd_final_v1.md` as the technical design document. It owns architecture, contracts, ownership boundaries, observability, and testing strategy.

Use `planning/wosm_phased_development_cycle_final_v1.md` as the implementation sequence. It owns phase order, phase scope, red-first expectations, and phase exit criteria.

Use `planning/harness_hook_ingress_refactor_master_plan.md` as the master plan for the provider-neutral hook ingress refactor, including fast socket ingest, status projection, spool behavior, reconcile scheduling, and hook-runner packaging decisions.

Use `planning/effect_boundary_hardening_sequence.md` when sequencing the follow-up runtime boundary hardening work for Effect, protocol IO, observer queues, reconciliation, provider calls, CLI diagnostics, and hook handling.

Use `planning/code_smell_remediation_p1_p2.md` when handling the P1/P2 code smell cleanup for provider diagnostics boundaries, recovery breadcrumb validation, diagnostics invariants, async spread cleanup, and optional object construction conventions.

Use `planning/light_commenting_audit.md` when adding sparse comments to non-obvious code paths such as protocol streams, command queue serialization, runtime retry/timeout behavior, provider parsing, and state-correlation heuristics.

Phase 0 work must specifically follow the Phase 0 section of the phased development plan.

Use `diagnostics.md` for the Phase 6 runtime doctor, debug bundle, redaction, and retention surface.

Use `system-dependencies.md` for external provider dependencies such as the real Worktrunk `wt` binary, install checks, and dependency diagnostics.

Use `install.md` for the Phase 18 fresh-checkout dogfood install flow and deterministic `pnpm smoke:release` validation.

Use `manual-smoke.md` for the Phase 11.5 runnable CLI, real Worktrunk smoke loop, and current manual TUI startup procedure.

Use `dogfood-checklist.md` and `release-readiness.md` for the Phase 16 real dogfood and release gate checklists.

Use `known-issues.md` and `release-notes/phase-18-dogfood-milestone.md` for the Phase 18 dogfood milestone caveats and release notes.
