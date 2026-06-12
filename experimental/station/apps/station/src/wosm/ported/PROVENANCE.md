# Ported apps/tui Logic — Provenance

This tree is a copy of `apps/tui`'s render-framework-free logic layer,
staging the Station WOSM view at parity with the TUI popup. It is **staging,
not a permanent fork**: at the spike verdict the intended move is a
mechanical extraction of this layer into a shared `@wosm/dashboard-core`
package both apps consume. Relative paths mirror upstream exactly so the
audit below stays one command.

- Upstream root: `apps/tui/src` (tests' fixtures: `apps/tui/test`)
- Upstream commit: `b906042` (main, 2026-06-12)
- Typecheck posture: upstream excludes `**/*.test.ts` and the `test/` tree
  from tsc; Station mirrors that (`tsconfig.json` excludes
  `src/wosm/ported/**/*.test.ts` and `src/wosm/test/**`). Tests run untyped
  under `bun test`, same as upstream's vitest.

## Audit command

From the repo root, after any upstream change:

```bash
for f in $(cd experimental/station/apps/station/src/wosm/ported && \
    find . -name '*.ts' ! -name 'PROVENANCE.md'); do
  diff -u "apps/tui/src/$f" \
    "experimental/station/apps/station/src/wosm/ported/$f" | head -40
done
```

Expected diffs are exactly the ledger below plus the mechanical
`vitest -> bun:test` import swap in `*.test.ts` files.

## Ledger

### Verbatim (modulo the vitest -> bun:test import swap in tests)

- `state/*` except `store.ts`, `store.test.ts` (note: upstream
  `observerBridge.ts` is **not ported** — see Adapted)
- `state/screens/*`, `state/operations/*`
- `selectors/*`
- `flows/*` (upstream `flows/__tests__/` integration tests are Ink-coupled
  and not ported)
- `components/Dashboard/layout.ts` + test
- `components/WorktreeRow/layout.ts`
- `components/ToastOverlay/layout.ts` + test
- `components/EditableTextInput/editing.ts`
- `services/types.ts`, `services/folderService.ts`, `services/errors/*`
- `../test/fixtures/snapshots.ts` (lives at `src/wosm/test/fixtures/`,
  matching upstream's `../../test/fixtures` relative imports)

### Adapted-extractions (pure functions lifted out of upstream `.tsx` files;
### verbatim bodies, the Ink components around them rewritten in
### `src/wosm/view/`)

- `components/WorktreeRow/rowInput.ts` — from `WorktreeRow.tsx`: row-grid
  input builders, status marker, activity cell, metadata segments/groups.
- `components/Dashboard/content.ts` — from `Dashboard.tsx` + `App/App.tsx`:
  header line composition, footer labels, project/empty-row labels,
  viewport-item -> row-input mapping, loading-body copy, observer header
  status, prompt-rows/modal facts; plus, from `CommandPrompt/CommandPrompt.tsx`,
  the prompt line copy + color (`commandPromptLineForScreen`,
  `textPromptForScreen` verbatim).
- `components/ToastOverlay/content.ts` — from `ToastOverlay.tsx`: toast
  title/border-color/detail/text-width presentation (verbatim bodies; the
  view maps Ink color names to theme hex).
- `components/HelpOverlay/helpPanel.ts` — from `HelpOverlay.tsx`: panel
  layout + line generation; content injected (Station derives it from the
  keymap data, copy pinned to upstream's list).
- `components/BottomSheetFrame/layout.ts` — from `BottomSheetFrame.tsx` +
  `NewSessionBottomSheet/layout.ts`: frame layout, content width, content
  row counts.

### Adapted (each carries an `ADAPTED` header comment)

- `state/store.ts` — the `@wosm/client` runtime + observer-bridge hooks are
  replaced by a `StationWosmStateSource` subscription
  (`../../store/sourceBridge.ts`); reconcile goes through the injected
  `ObserverService` (Station's stub until client plan PR 4); `handleKey`
  returns the transition meta (`dismissPopup`/`exitCode`) so the overlay
  keymap layer can map it to a router outcome.
- `state/store.test.ts` — the upstream cases asserting client-runtime
  behavior (event subscription lifecycle, live event reduction,
  connect-failure hooks) are rewritten against source semantics; the
  `command.failed`-event toast case is dropped (event reduction lives inside
  the source's client runtime in Station). Folder-service/addProject and
  scroll cases are verbatim plus the required `source` option.
- `../test/support/fakeObserverService.ts` — one import path rewritten
  (`../../src/services/types.js` -> `../../ported/services/types.js`).

### Not ported

- `state/observerBridge.ts` — replaced by `src/wosm/store/sourceBridge.ts`
  (Station-authored; maps `StationWosmState` into `TuiState` with the same
  connection-status presentation and recovery-toast semantics).
- `state/index.ts` barrel.
- `widgets/*` — deferred; the time widget lands with the header view (slice
  2), the weather widget (network client + `@wosm/config` types) is out of
  the first cut.
- All `.tsx` render-layer files — rewritten as OpenTUI views under
  `src/wosm/view/`.
- `selectors/featureFlags.test.ts` companions exist; `featureFlags.ts` is
  ported verbatim.

## Known behavioral divergences (deliberate, Station-only)

- Exit intent: apps/tui maps Ctrl-C / Q-without-dismiss to `exitCode 0`
  (process exit). Station maps exit intent to closing WOSM mode — the
  workspace owns process exit via Ctrl-Q. See `WOSM_GLOBAL_BINDINGS` in
  `src/wosm/input/wosmKeymap.ts`.
- Q/Esc dismiss: runtime flags are pinned `persistentPopup: true,
  canDismissPopup: true` (the WOSM view is always a persistent popup); the
  store-level `onDismiss` is a recorded no-op — the router executes the
  close via the coordination store (`overlay-close` outcome).
- `halted` connection state (no TUI equivalent) presents as
  displayOnly/reconnecting with the `lastError` carrying the explanation.
- Mutating command dispatch is stubbed until client plan PR 4
  (`src/wosm/store/stubObserverService.ts`): pending local-row visuals run
  the real ported code paths, then resolve as rejected receipts whose
  SafeError names the gate.
