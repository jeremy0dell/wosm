# Station TUI Overlay Seams Review

Status: active review
Date: 2026-06-12
Scope: `station-overlay` branch, read-only architecture review

## Purpose

This document integrates the Station overlay review focused on where `apps/tui`
has been brought into, recreated for, or coupled to the Station experiment.

The review used four lenses:

- entrypoints and lifecycle seams
- `apps/tui` architecture and internal style
- Station experiment boundaries
- tests, validation, and maintainability risk

The goal is not to block the spike. The goal is to name the places where the
current staging shape is useful, where it is becoming architectural debt, and
what refactors would make the code easier to understand before Station command
dispatch and promotion decisions add more surface area.

## Summary Judgment

The current boundary is mostly right:

- Station does not import `apps/tui` or Ink directly.
- Live observer state flows through `@wosm/client`.
- Mock versus observer source selection is kept behind a source factory.
- Station remains isolated under `experimental/station`.

The main concern is that Station has recreated the TUI dashboard core, not only
the renderer. That is acceptable as spike staging because it is documented and
tested, but it should not become the permanent shape. Before more substantial
Station command work, extract the render-framework-free dashboard machine into a
shared package consumed by both `apps/tui` and Station.

## Findings

### High: Station Recreated The TUI Dashboard Core

Station documents the WOSM overlay as the full dashboard at `apps/tui` popup
parity, with the TUI render-framework-free logic layer ported under `ported/`
and only the OpenTUI render layer rewritten:

- `experimental/station/apps/station/src/wosm/README.md:3`
- `experimental/station/apps/station/src/wosm/ported/PROVENANCE.md:3`

The copied surface is broad: state, screens, operations, selectors, flows,
services, fixtures, and pure layout:

- `experimental/station/apps/station/src/wosm/ported/PROVENANCE.md:34`
- `experimental/station/apps/station/src/wosm/ported/state/store.ts:1`

The guardrail is good: Station explicitly rejects `apps/tui` and Ink imports,
and it limits WOSM package dependencies to linked core packages:

- `experimental/station/apps/station/src/wosm/importBoundaries.test.ts:51`
- `experimental/station/apps/station/src/wosm/importBoundaries.test.ts:63`

The risk is drift. The provenance file says this is staging, not a permanent
fork, but the current drift gate is a manual diff command rather than an
enforced test:

- `experimental/station/apps/station/src/wosm/ported/PROVENANCE.md:17`

Recommendation: extract the shared render-free dashboard core before another
large Station dashboard slice.

### High: Live State And Command Dispatch Are Split

Live observer state uses `@wosm/client`:

- `experimental/station/apps/station/src/sources/observerWosmStateSource.ts:19`

But the exposed `StationWosmStateSource` carries only state, start, stop, and
subscribe:

- `experimental/station/apps/station/src/sources/types.ts:25`

Command dispatch is separately stubbed in the Station WOSM view store:

- `experimental/station/apps/station/src/wosm/store/wosmViewStore.ts:14`
- `experimental/station/apps/station/src/wosm/store/stubObserverService.ts:35`

That is fine for the read-only observer overlay, but it is the exact place where
Station command dispatch could accidentally create a second live observer client
or leave mock/read-only behavior hidden behind a `TuiObserverService`-shaped
stub.

Recommendation: replace `createStationWosmStateSource()` with one identity-free
client boundary:

```ts
type StationWosmClient = {
  state: StationWosmStateSource;
  service: ObserverService;
  start(): void;
  stop(): Promise<void>;
};
```

For live mode, construct one `ObserverService` and one `WosmClientRuntime` from
it. For mock mode, return a fixture source plus the rejecting command service.
Then `createWosmViewStore(client)` consumes both facets explicitly.

### High: The Actual Overlay Composition Lacks A Rendered Test

`main.tsx` wires together source creation, the WOSM view store, the Station
input runtime, and the overlay render:

- `experimental/station/apps/station/src/main.tsx:14`
- `experimental/station/apps/station/src/main.tsx:74`

`WosmOverlay` owns popup geometry and mouse dispatch into Station:

- `experimental/station/apps/station/src/wosm/WosmOverlay.tsx:65`

Current golden tests render `DashboardRoot` directly:

- `experimental/station/apps/station/src/wosm/view/dashboard.golden.test.tsx:53`

Those tests are valuable, but they do not prove the actual integration seam:
Ctrl-O/header toggle, shell input guarding, source/store lifecycle, overlay
state preservation across close/open, and cleanup.

Recommendation: add a small testable Station app composition or harness that
renders with a fake `StationWosmStateSource`, toggles WOSM mode, verifies the
overlay frame, proves shell writes are blocked while the overlay is open,
updates the source and sees repaint, closes/reopens the overlay while preserving
view state, and confirms stop/unsubscribe behavior.

### Medium: Station Has A Second Keymap Product Contract

Station has a data-driven WOSM keymap over the ported transition machine:

- `experimental/station/apps/station/src/wosm/input/wosmKeymap.ts:96`
- `experimental/station/apps/station/src/wosm/input/wosmKeymap.test.ts:1`

This is a strong local design, but upstream `apps/tui` still hardcodes related
help/footer behavior in Ink components:

- `apps/tui/src/components/HelpOverlay/HelpOverlay.tsx:19`
- `apps/tui/src/components/Dashboard/Dashboard.tsx:367`
- `apps/tui/src/state/transition.ts:28`

Recommendation: move binding metadata next to the shared transition machine in
the extracted dashboard core. Ink and OpenTUI should only adapt raw key input
and render the metadata.

### Medium: Shared Client And Socket Path Boundaries Still Leak App Detail

`@wosm/client` is shared, but its user-facing error messages still say "TUI":

- `packages/client/src/observerService.ts:27`
- `packages/client/src/observerService.ts:56`

Station also mirrors observer socket path resolution locally instead of sharing
a small resolver:

- `experimental/station/apps/station/src/sources/stationSocketPath.ts:3`
- `packages/config/src/observerPaths.ts:14`

Recommendation: make `@wosm/client` messages client-neutral or label-aware, and
expose a lightweight observer socket resolver that does not force Station to
import the whole config stack.

### Medium: Validation Instructions Are Easy To Run From The Wrong Directory

The WOSM view README says to `cd experimental/station` and lists `bun run test`
as the acceptance suite:

- `experimental/station/apps/station/src/wosm/README.md:14`
- `experimental/station/apps/station/src/wosm/README.md:41`

But the root Station experiment package does not define `test`; it defines
`test:pty` and `typecheck`. The `test` script exists under `apps/station`:

- `experimental/station/package.json:10`
- `experimental/station/apps/station/package.json:11`

Recommendation: either add a root Station `test` wrapper or correct the README
to use `bun run --cwd apps/station test`.

### Low: `@wosm/tui` Exports Too Many Internals

Station correctly forbids importing `@wosm/tui`, but the package currently
exports app internals, selectors, services, and state:

- `apps/tui/src/index.ts:1`
- `apps/tui/src/state/index.ts:1`

Recommendation: keep `@wosm/tui` public exports narrow, centered on `runTui`
and truly public types. Shared dashboard logic should live in a named shared
package instead of being consumed through TUI internals.

## Proposed Refactor Shape

Move toward this structure:

```text
packages/dashboard-core/
  state/
  selectors/
  flows/
  operations/
  layout/
  content/
  keymap/

apps/tui/src/
  App/
  components/              Ink adapters over dashboard-core
  runTui.tsx

experimental/station/apps/station/src/
  wosm/view/               OpenTUI adapters over dashboard-core
  wosm/input/              Station key/mouse adapters only
  wosm/store/              thin dashboard-core wiring
  sources/                 mock/live StationWosmClient factory
```

Candidate extraction contents:

- `apps/tui/src/state/**`
- `apps/tui/src/selectors/**`
- `apps/tui/src/flows/**`
- `apps/tui/src/services/{types,folderService,errors}`
- pure row/header/footer/help/layout helpers currently inside TUI components
- Station's keymap metadata, once reconciled with upstream TUI behavior

Keep app-local:

- Ink components and Ink input normalization in `apps/tui`
- OpenTUI renderables and mouse target plumbing in Station
- Station workspace store, pane focus, PTY registry, and terminal rendering
- popup/persistent UI lifecycle until Station has a real CLI entrypoint

## Recommended Sequence

1. Add immediate guardrails while the copy still exists.
   - Add `test:ported-parity` for the verbatim ledger.
   - Add a rendered Station overlay composition test.
   - Add tests that drive `createWosmViewStore` through row activation, `N`,
     `A`, `X`, `R`, and `Z`, asserting pending visuals and the
     `STATION_DISPATCH_PENDING` toast.
   - Fix the Station WOSM README test command or add a root wrapper.

2. Extract pure helpers from `apps/tui` component files.
   - Move header/footer/project labels, help panel content, row input builders,
     and row metadata segment construction into pure modules first.
   - Keep the extracted modules app-local until the movement is mechanical.

3. Promote the shared dashboard core package.
   - Move state, selectors, flows, operations, layout, content, and keymap
     metadata into `packages/dashboard-core`.
   - Point `apps/tui` and Station at that package.
   - Remove Station's `ported/` tree.

4. Unify Station's WOSM client boundary before command dispatch.
   - Replace state-only source creation with `StationWosmClient`.
   - Make live mode share one `ObserverService` between runtime state and
     command dispatch.
   - Keep mock/read-only command behavior explicit and identity-free downstream.

5. When `wosm station` arrives, generalize existing persistent UI lifecycle.
   - Do not create a parallel Station popup/session registry.
   - Reuse the checkout-root scoping and persistent UI ideas already built for
     the TUI path.

## Do Not Do Yet

- Do not import `apps/tui` or `@wosm/tui` into Station just to remove the copy.
  The current isolation guard is correct.
- Do not add Station to normal root pnpm workspace, build, or CI paths before
  the spike is ready for promotion.
- Do not move Station PTY, renderer, or OpenTUI runtime code into shared WOSM
  packages while dependency viability is still part of the spike.
- Do not start Station command dispatch by creating a second observer live
  client beside `@wosm/client`.

## Validation And UX

No files were changed during the review; this document records read-only
findings.

Manual UX verification for this branch:

```bash
cd experimental/station
bun run --cwd apps/station station
WOSM_STATION_SOURCE=mock bun run --cwd apps/station station
```

Verify:

- Ctrl-O toggles WOSM mode.
- Header click toggles WOSM mode.
- Ctrl-Q exits Station.
- Shell input is swallowed while the WOSM overlay is open.
- Help, search, new session, add project, rename, remove, refresh, row clicks,
  mouse wheel, sheet choices, and toast dismissal behave like the TUI popup.
- Live observer display-only/reconnect state presents without breaking the
  shell pane underneath.
- Stubbed mutating commands show pending visuals and then the
  `STATION_DISPATCH_PENDING` feedback.

For any dashboard-core extraction, verify both:

```bash
pnpm wosm tui
cd experimental/station && WOSM_STATION_SOURCE=mock bun run --cwd apps/station station
```

The expected UX implication is no visible behavior change: the refactor should
only remove drift risk and make the shared dashboard behavior easier to reason
about.
