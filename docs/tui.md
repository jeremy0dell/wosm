# TUI Development

Status: current living doc for `apps/tui` implementation, React/Ink patterns, and TUI-specific test expectations.

The TUI is a terminal UI client. It renders observer snapshots and events, owns local interaction state, and dispatches typed observer commands. It does not derive runtime truth from providers.

## Boundaries

- Keep `apps/tui` provider-neutral. Do not import provider packages, read SQLite, run `wt`, run `tmux`, run `git` or `gh`, or parse raw provider payloads.
- Render normalized contracts from `@wosm/contracts` and use `@wosm/protocol` through the TUI service layer.
- React/Ink components should stay plain and readable. Runtime orchestration belongs in services or hooks, not presentation components.
- Selectors, keymaps, actions, UI reducers, and fixtures should stay pure TypeScript.
- TUI service code may use `@wosm/runtime` for observer IO, subscriptions, command dispatch, timeout, retry, cancellation, and cleanup boundaries.
- The TUI may filter, group, sort, label, and decorate snapshot rows. It must not infer agent truth from provider-specific details.

## Surface Rules

- Treat the active TUI as the full terminal canvas. Layout code should account for the terminal viewport, not a decorative parent container.
- Keep header, body, footer, overlays, prompts, and toasts from overlapping at narrow or short terminal sizes.
- Popup mode is still the TUI. Its close behavior and footer copy must match popup semantics, such as `q/esc:close` when a warm dismissal is expected.
- Do not add a row-level inspect/debug panel in v1. Use CLI JSON, `wosm doctor`, `wosm snapshot --json`, and debug bundles for support evidence.
- Do not render `providerData` or raw provider debug payloads in ordinary TUI surfaces.

## Code Organization

- Use `apps/tui/src/services` for observer protocol calls and error mapping.
- Use `apps/tui/src/hooks` for TUI lifecycle orchestration such as initial snapshot load, event subscription, reconnect behavior, and command waiting.
- Use `apps/tui/src/selectors.ts` for snapshot-to-view grouping and filtering.
- Use `apps/tui/src/actions.ts`, `keymap.ts`, `eventReducer.ts`, and `uiState.ts` for command construction, keyboard intent, event application, and local UI state.
- Keep reusable rendering surfaces under `apps/tui/src/components`.
- Put component-specific tests next to the component tree in a plural `__tests__` directory.

## Testing

For TUI changes, choose the narrowest tests that prove the behavior, then add broader coverage only when the change crosses layers.

- Component rendering belongs in source-adjacent tests under `apps/tui/src/components/**/__tests__`.
- Pure selectors, actions, keymaps, reducers, safe-error mapping, and UI state belong in `apps/tui/test/unit`.
- Full app render, keyboard flows, command UX, observer-service integration, help overlay behavior, and popup focus/close behavior belong in `apps/tui/test/integration`.
- Use `renderToString` when exact terminal text, spacing, layout, footer placement, or clipping matters.
- Use `ink-testing-library` when keyboard input, focus, prompt, toast, or command dispatch behavior matters.
- If a change touches a component and an interaction flow, test both the component surface and the flow. A broad app render test alone is not enough for touched component behavior.

Useful focused commands:

```bash
pnpm exec vitest run apps/tui/src/components/__tests__/WorktreeRow.test.tsx --config config/vitest/vitest.unit.config.ts
pnpm exec vitest run apps/tui/test/unit/selectors.test.ts --config config/vitest/vitest.unit.config.ts
pnpm exec vitest run apps/tui/test/integration/app-render.test.tsx --config config/vitest/vitest.integration.config.ts
```

Before merging meaningful TUI work, run at least the touched focused tests plus the deterministic gate required by the change. For cross-layer TUI, observer, protocol, or command changes, prefer `pnpm test:all`.

## Review Checklist

- Does the TUI still consume snapshots/events and dispatch commands instead of reaching into providers?
- Are React/Ink components free of observer IO, provider parsing, and runtime orchestration?
- Are viewport-sensitive surfaces checked for clipping or overlap?
- Are popup-mode labels and close behavior covered when changed?
- Did every touched component get source-adjacent coverage when behavior changed?
- Are unit tests proving pure selection/action/keymap logic separately from interaction tests?
- Is raw provider/debug evidence kept in CLI/debug-bundle paths rather than normal TUI rendering?
