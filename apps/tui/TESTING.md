# TUI Testing Guidelines

TUI tests should live near the behavior they protect. Prefer the narrowest useful boundary first, then add broader coverage when behavior crosses components, hooks, services, or app flows.

## Layout

- Component, hook, and focused module tests should usually live in the same small directory as the source they primarily exercise.
- Feature or domain integration tests should live in a `__tests__` directory at the nearest meaningful parent boundary.
- Root-level e2e coverage is appropriate for full product flows that cross the TUI, observer, protocol, providers, or real terminal behavior.
- Use `*.test.ts` or `*.test.tsx` for colocated local tests.
- Use `*.integration.test.ts` or `*.integration.test.tsx` for parent-boundary integration tests.
- Avoid random floating test files outside the relevant source, feature, domain, or e2e boundary.

Example:

```text
apps/tui/src/sessions/
  SessionList.tsx
  SessionList.test.tsx
  useSessionSelection.ts
  useSessionSelection.test.ts
  __tests__/
    session-keyboard-flow.integration.test.tsx

tests/e2e/
  tui-smoke.test.ts
```

## What To Test Where

- Colocated component tests: rendering, accessibility-oriented terminal text, local state, input handling, edge cases, and visual clipping owned by one component.
- Colocated hook tests: state transitions, subscriptions, cleanup, retries, cancellation, and error behavior owned by one hook.
- Parent `__tests__` integration tests: interactions across multiple components, hooks, reducers, selectors, or service boundaries within one feature/domain.
- Root e2e tests: user-visible flows that require the built CLI/TUI, observer lifecycle, real or fake external tools, tmux/popup behavior, or cross-package wiring.

## Principles

- Test observable behavior rather than implementation details.
- Small pass-through components do not need dedicated tests unless they encode behavior, formatting, accessibility, layout, or integration assumptions.
- If a change touches both a local component surface and a cross-component interaction, cover both levels.
- Keep deterministic tests in normal unit/integration lanes. Real provider or real terminal e2e tests must remain opt-in and clearly gated by environment variables.
