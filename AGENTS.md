# Agent Guidance

For architecture or boundary decisions, read `docs/architecture.md`.

For development, test, and documentation workflow, read `docs/development.md`.

For runtime trace IDs, command IDs, diagnostic IDs, or live debugging, read `docs/debugging.md`.

The old rebuild TDD in `docs/planning/historical/` is a historical V1 baseline. Use it only for explicit original rationale. For ordinary work, current code, current tests, runtime evidence, and the living docs above supersede it.

When finishing a change and summarizing it, include a minimal line or section naming the specific UX implication and how to manually verify it when possible.

PR titles should be semantic and reviewer-oriented, using a type/domain shape like `refactor(protocol): centralize observer command completion waits`; do not add agent tags.

WOSM is terminal/TUI-first. Ignore generic web, frontend, site, image, and browser guidance unless the task explicitly targets a web frontend or browser-rendered UI.

## Optional Object Construction

`exactOptionalPropertyTypes` is intentional. Preserve the difference between absent optional fields and fields set to `undefined`.

For complex mappers, persistence row conversion, diagnostics construction, error shaping, and provider payload parsing, prefer typed local builders with explicit `if` assignments over dense `...(value === undefined ? {} : { value })` object spreads. Small conditional spreads are acceptable when they stay local and obvious.

Do not use `...(await somePromise)` in production array or object construction. Await into a named local first.

Provider-specific diagnostics and behavior must stay behind provider or integration boundaries. Observer/core code should aggregate provider diagnostics through contracts or injected capabilities, not import concrete providers directly.

Use strict schemas for untrusted input and shared payload formats. Avoid maintaining parallel hand-written validators for the same shape.

Treat `unknown` as a boundary-only type. At JSON/TOML/CLI/hook/provider boundaries, parse once with a strict Zod schema or contract parser, then pass typed values inward.

Do not add local JavaScript-style type helper clusters such as `isRecord`, `asRecord`, `stringField`, `numberField`, or repeated `"key" in value`/`typeof value.foo === ...` checks for shapes that already have, or should have, a schema or discriminated TypeScript type. If the shape is shared, put the schema in `packages/contracts`; if it is provider-private, keep a provider-local schema beside the adapter/parser.

Inside already-typed code, prefer discriminated unions, exhaustive `switch` handling, typed builders, and inferred schema types over runtime property probing. Runtime shape probing is acceptable only for truly generic traversal/error-normalization code or the first step before schema parsing.

Observer/core code should not scrape provider-specific keys out of generic `providerData`. Normalize those fields at the provider boundary into contract fields, correlation fields, or a provider-owned schema.

This convention comes from `docs/planning/completed/code_smell_remediation_p1_p2.md`.

## Runtime Debugging

For runtime trace IDs, command IDs, and diagnostic IDs, do not start by grepping checked-in source. Runtime evidence lives under the configured observer state directory, defaulting to `~/.local/state/wosm`.

Start with the narrowest matching tool:

- trace, command, or diagnostic id: `wosm debug trace <id>`
- no id yet, historical/local symptom: `wosm debug logs [query]`
- latest known failure: `wosm debug trace --latest-failure`
- process status only: `wosm observer status`
- current runtime health: `wosm doctor`
- current graph truth: `wosm snapshot --json`
- live event stream: `wosm observe --include-snapshot --duration 3s`, with `--json` for agent-readable output
- command lifecycle record: `wosm command get <commandId>`
- redacted shareable evidence: `wosm debug bundle --trace <traceId>`, `wosm debug bundle --command <commandId>`, or `wosm debug bundle --latest-failure`
- provider hook setup: `wosm hooks doctor worktrunk|codex|cursor|opencode` or `wosm event-hooks doctor`
- setup/tool readiness: `wosm setup check --json`, `wosm setup system --check`, or `pnpm setup:system:check`

If the user says "no action", treat debugging as read-only: inspect only existing logs, existing bundles, existing command/error records, and `wosm debug trace` / `wosm debug logs` output. Do not start/restart observer, run commands that call or auto-start the observer, retry commands, kill processes, mutate setup/hooks/config, or write a new bundle unless explicitly asked.

Provider hooks are delivery hints, not runtime truth. Use hook logs and hook doctors to diagnose delivery/setup, then use observer health, reconcile output, and snapshots for current truth.

Key runtime files are `logs/observer.jsonl`, `logs/hooks.jsonl`, `logs/cli.jsonl`, `logs/tui.jsonl`, latest `diagnostics/*/diagnostic-index.json`, `diagnostics/*/commands.jsonl`, `diagnostics/*/errors.jsonl`, and `spool/hooks/`.
