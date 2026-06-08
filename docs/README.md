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
- [Harness ingress](harness-ingress.md) is the current guidance for provider harness event admission and allow-listing.
- [Manual smoke testing](manual-smoke.md) is the detailed reference for runnable CLI/TUI smoke loops, real provider lanes, popup behavior, and cleanup smoke.
- [Install](install.md) is the current local-checkout setup path for Node.js 24.x, pnpm 11, system dependency checks, build, smoke, and local CLI use.
- [System dependencies](system-dependencies.md) is the reference for external provider tools, install checks, command resolution, and dependency diagnostics.
- [Release readiness](release-readiness.md) is the current gate reference for `standard-ci`, manual release checks, real E2E checks, and documentation release criteria.
- [Local use checklist](local-use-checklist.md) is the manual checklist for relying on wosm in day-to-day local agent work.
- [Known issues](known-issues.md) records accepted limitations for the current local-use checkpoint and is operational status, not architecture authority.
- [Test layout](../tests/README.md) is the reference for deterministic, e2e, real-provider, and support-test locations.

## Active Plans

- [Terminal ownership P0 blocker fix](planning/active/terminal_ownership_p0_blocker_fix.md) is a scoped planning addendum for terminal intent ownership; read only when changing terminal command routing or provider ownership.
- [Terminal leakage P1 fix](planning/active/terminal_leakage_p1_fix.md) is a scoped planning addendum for cleaning terminal topology leakage after the P0 terminal boundary.
- [Effect boundary hardening sequence](planning/active/effect_boundary_hardening_sequence.md) is a scoped planning addendum for runtime timeout, retry, cancellation, queue, protocol, observer, provider, CLI, and TUI IO boundaries.
- [TypeScript shape boundary audit](planning/active/typescript_shape_boundary_audit.md) is the current one-off audit brief for finding JavaScript-style runtime shape probing where schemas or typed unions should own the shape.
- [Light commenting audit](planning/active/light_commenting_audit.md) is a scoped planning addendum for adding sparse comments to non-obvious runtime, provider, protocol, and correlation code paths.
- [Package and app boundary cleanup audit](planning/active/package_app_boundary_cleanup_audit.md) is an active cleanup audit for package/app boundaries, dead placeholders, provider-hook adapters, and observer event subscriber queue risk.
- [WOSM competitive backlog](planning/active/wosm_competitive_backlog.md) is the active product-priority note for differentiating WOSM from adjacent terminal-agent tools.
- [TUI dashboard visual notes](planning/active/tui_dashboard_visual_notes.md) are active product notes for TUI row layout and visual direction, not contract authority.

## Historical/Deprecated Baselines

- [wosm rebuild TDD Final V1](planning/historical/wosm_rebuild_tdd_final_v1.md) is a historical V1 baseline retained for original architecture rationale and deprecated as mandatory startup context.

## Completed Records And Audits

- [CI lane evolution plan](planning/completed/ci_lane_evolution_plan.md) is a completed planning record for separating deterministic CI, release smoke, e2e, docs-only, and real-provider lanes.
- [Code smell remediation P1/P2](planning/completed/code_smell_remediation_p1_p2.md) is a completed planning record for optional object construction, provider diagnostics boundaries, validation, and async spread cleanup.
- [Hook/event naming audit](planning/completed/hook_event_naming_audit.md) is a completed cleanup map for hook/event terminology across contracts, protocol, observer, integrations, CLI, tests, and docs.
- [Harness socket ingress and observer queue plan](planning/completed/harness_socket_ingress_and_observer_queue_plan.md) is a completed planning record for removing the `wosm-hook` hot path and fixing observer ingress backpressure.
- [Observer hook reconcile profiling](planning/completed/observer_hook_reconcile_profiling.md) is a completed profiling note for observer responsiveness under high hook volume.
- [OpenCode harness integration plan](planning/completed/opencode_harness_integration_plan.md) is a completed planning record for real OpenCode launch, plugin event capture, observer-shaped event reports, contract changes, and deterministic plus real-provider tests.
- [Provider hook scope guard plan](planning/completed/provider_hook_scope_guard_plan.md) is a completed planning record for provider hook ownership guards and ignored out-of-scope hooks.
- [TUI screen-driven state transition](planning/completed/tui_screen_driven_state_transition.md) is a completed simplification plan for TUI state, keys, and screen-owned transitions.
- [TypeScript braid remediation plan](planning/completed/typescript_braid_audit_plan.md) is an executed remediation record and follow-up inventory, not a current broad refactor mandate.
- [Branch PR/CI metadata research](planning/completed/branch/branch_pr_ci_metadata_research.md) is a research record for branch metadata sources and tradeoffs; current metadata code/tests are authoritative.
- [PR 1 branch metadata plan](planning/completed/branch/pr1_contracts_worktrunk_tui_plan.md) is a completed planning record for normalized metadata contracts, Worktrunk parsing, and TUI row display.
- [PR 2 local branch diff plan](planning/completed/branch/pr2_local_branch_diff_enrichment_plan.md) is a completed planning record for local branch diff enrichment and current metadata persistence.
- [PR 3 code host PR/CI plan](planning/completed/branch/pr3_code_host_pr_ci_enrichment_plan.md) is a completed planning record for repository provider, GitHub PR metadata, and aggregate check enrichment.
