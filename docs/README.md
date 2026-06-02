# wosm Docs Index

This index classifies docs by current use. Planning docs are grouped by lifecycle under `planning/active/`, `planning/completed/`, and `planning/historical/`. When a doc conflicts with current code, current tests, or runtime evidence, verify the implementation and update the doc.

## Current Living Docs

- [Architecture](architecture.md) is the current authoritative boundary map for ordinary architecture and ownership decisions.
- [Naming](naming.md) is the current terminology guide for provider hooks, provider hook ingress, harness event reports, WOSM events, and observer event hooks.
- [Development](development.md) is the current authoritative guide for environment, test gates, data-shape conventions, and agent-instruction maintenance.
- [TUI development](tui.md) is the current guide for `apps/tui` React/Ink coding, terminal layout, boundary, and test expectations.
- [Debugging](debugging.md) is the current authoritative entrypoint for trace IDs, command IDs, diagnostic IDs, no-action debugging, and runtime evidence lookup.

## Operational References

- [Diagnostics](diagnostics.md) is the detailed operational reference for `wosm doctor`, debug bundles, redaction, retention, hook setup, and diagnostic evidence.
- [Manual smoke testing](manual-smoke.md) is the detailed reference for runnable CLI/TUI smoke loops, real provider lanes, popup behavior, and cleanup smoke.
- [Install](install.md) is the current local-checkout setup path for Node.js 24.x, pnpm 11, system dependency checks, build, smoke, and local CLI use.
- [System dependencies](system-dependencies.md) is the reference for external provider tools, install checks, command resolution, and dependency diagnostics.
- [Release readiness](release-readiness.md) is the current gate reference for `standard-ci`, manual release checks, real dogfood checks, and documentation release criteria.
- [Dogfood checklist](dogfood-checklist.md) is the manual checklist for relying on wosm in day-to-day local agent work.
- [Known issues](known-issues.md) records accepted limitations for the current dogfood milestone and is operational status, not architecture authority.
- [Phase 18 release notes](release-notes/phase-18-dogfood-milestone.md) record the dogfood checkpoint and are historical release notes.
- [Test layout](../tests/README.md) is the reference for deterministic, e2e, real-provider, and support-test locations.

## Active Plans

- [CI lane evolution plan](planning/active/ci_lane_evolution_plan.md) is the active planning reference for promoting or separating deterministic, smoke, e2e, docs-only, and real-provider CI lanes.
- [Terminal ownership P0 blocker fix](planning/active/terminal_ownership_p0_blocker_fix.md) is a scoped planning addendum for terminal intent ownership; read only when changing terminal command routing or provider ownership.
- [Terminal leakage P1 fix](planning/active/terminal_leakage_p1_fix.md) is a scoped planning addendum for cleaning terminal topology leakage after the P0 terminal boundary.
- [Provider hook scope guard plan](planning/active/provider_hook_scope_guard_plan.md) is a scoped planning addendum for hook ownership and ignored-hook behavior across provider-installed hooks.
- [Effect boundary hardening sequence](planning/active/effect_boundary_hardening_sequence.md) is a scoped planning addendum for runtime timeout, retry, cancellation, queue, protocol, observer, provider, CLI, and TUI IO boundaries.
- [Code smell remediation P1/P2](planning/active/code_smell_remediation_p1_p2.md) is a scoped planning addendum for optional object construction, provider diagnostics boundaries, validation, and async spread cleanup.
- [TypeScript shape boundary audit](planning/active/typescript_shape_boundary_audit.md) is the current one-off audit brief for finding JavaScript-style runtime shape probing where schemas or typed unions should own the shape.
- [Hook/event naming audit](planning/active/hook_event_naming_audit.md) is the active cleanup map for hook/event terminology across contracts, protocol, observer, integrations, CLI, tests, and docs.
- [Light commenting audit](planning/active/light_commenting_audit.md) is a scoped planning addendum for adding sparse comments to non-obvious runtime, provider, protocol, and correlation code paths.
- [Harness socket ingress and observer queue plan](planning/active/harness_socket_ingress_and_observer_queue_plan.md) is the active plan for removing the `wosm-hook` hot path and fixing observer ingress backpressure.
- [OpenCode harness integration plan](planning/active/opencode_harness_integration_plan.md) is the active plan for real OpenCode launch, plugin event capture, observer-shaped event reports, contract changes, and deterministic plus real-provider tests.
- [TUI dashboard visual notes](planning/active/tui_dashboard_visual_notes.md) are active product notes for TUI row layout and visual direction, not contract authority.

## Historical/Deprecated Baselines

- [wosm rebuild TDD Final V1](planning/historical/wosm_rebuild_tdd_final_v1.md) is a historical V1 baseline retained for original architecture rationale and deprecated as mandatory startup context.
- [wosm phased development cycle Final V1](planning/historical/wosm_phased_development_cycle_final_v1.md) is a historical V1 build sequence retained for phase archaeology and deprecated as mandatory startup context.
- [Harness hook ingress refactor master plan](planning/historical/harness_hook_ingress_refactor_master_plan.md) is superseded for future transport/backpressure work by the socket ingress and observer queue plan, but remains useful historical context for the first provider-neutral harness report slices.

## Completed Records And Audits

- [TypeScript braid remediation plan](planning/completed/typescript_braid_audit_plan.md) is an executed remediation record and follow-up inventory, not a current broad refactor mandate.
- [Branch PR/CI metadata research](planning/completed/branch/branch_pr_ci_metadata_research.md) is a research record for branch metadata sources and tradeoffs; current metadata code/tests are authoritative.
- [PR 1 branch metadata plan](planning/completed/branch/pr1_contracts_worktrunk_tui_plan.md) is a completed planning record for normalized metadata contracts, Worktrunk parsing, and TUI row display.
- [PR 2 local branch diff plan](planning/completed/branch/pr2_local_branch_diff_enrichment_plan.md) is a completed planning record for local branch diff enrichment and current metadata persistence.
- [PR 3 code host PR/CI plan](planning/completed/branch/pr3_code_host_pr_ci_enrichment_plan.md) is a completed planning record for repository provider, GitHub PR metadata, and aggregate check enrichment.
