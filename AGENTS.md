# Agent Guidance

Before making architecture or boundary decisions, read `docs/planning/wosm_rebuild_tdd_final_v1.md`.

Before implementing any phase, read `docs/planning/wosm_phased_development_cycle_final_v1.md`.

## Optional Object Construction

`exactOptionalPropertyTypes` is intentional. Preserve the difference between absent optional fields and fields set to `undefined`.

For complex mappers, persistence row conversion, diagnostics construction, error shaping, and provider payload parsing, prefer typed local builders with explicit `if` assignments over dense `...(value === undefined ? {} : { value })` object spreads. Small conditional spreads are acceptable when they stay local and obvious.

Do not use `...(await somePromise)` in production array or object construction. Await into a named local first.

Provider-specific diagnostics and behavior must stay behind provider or integration boundaries. Observer/core code should aggregate provider diagnostics through contracts or injected capabilities, not import concrete providers directly.

Use strict schemas for untrusted input and shared payload formats. Avoid maintaining parallel hand-written validators for the same shape.

This convention comes from `docs/planning/code_smell_remediation_p1_p2.md`.
