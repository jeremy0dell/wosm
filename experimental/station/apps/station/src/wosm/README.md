# Station WOSM View

The full dashboard behind Ctrl-O / header-click, at parity with the
`apps/tui` popup. Architecture: render-framework-free dashboard behavior comes
from `@wosm/dashboard-core`; the OpenTUI render layer under `view/` and the
Station input/mouse plumbing stay local. Input registers into Station's router:
the overlay keymap slot delegates to the shared transition machine
(`input/wosmOverlayLayer.ts`), and mouse targets resolve through one pure
`routeWosmMouse` (`input/wosmMouse.ts`).

## Running it

```bash
cd experimental/station

# live observer (default)
bun run station

# deterministic fixtures, no observer needed
WOSM_STATION_SOURCE=mock bun run station
WOSM_STATION_SOURCE=mock WOSM_STATION_SCENARIO=many-projects bun run station
WOSM_STATION_SOURCE=mock WOSM_STATION_SCENARIO=attention-and-failures bun run station
WOSM_STATION_SOURCE=mock WOSM_STATION_SCENARIO=disconnected bun run station
```

Ctrl-O or header click toggles WOSM mode; the shell pane survives underneath.
Ctrl-Q always exits Station (reserved chords pierce the overlay).

## Keymap

The keymap is data over the shared transition machine
(`input/wosmKeymap.ts`): per-mode binding tables that drive the help overlay
and the mouse vocabulary. Runtime keyboard dispatch always goes through the
machine — a table omission cannot change behavior; it fails
`input/wosmKeymap.test.ts` instead (machine-coverage, stale-binding, and
declared-vs-derived-outcome checks).

## Acceptance suite

- `bun run test` — everything below; `bun run typecheck`.
- Keymap anti-drift: `input/wosmKeymap.test.ts`.
- Sequence translation: `input/sequenceToTuiKey.test.ts`.
- Mouse guard matrix + click/key equivalence: `input/wosmMouse.test.ts`.
- Router/runtime conformance (reserved chords, modal swallow, paste,
  overlay-close): `../input/wosmIntegration.test.ts`.
- Live command dispatch through the shared client (focus, jump-to-session,
  Z-through-runtime, convergence, recovery): `store/wosmCommandDispatch.test.ts`.
- Golden frames: `view/dashboard.golden.test.tsx` (scenario × size matrix +
  span color probes), `view/modals.golden.test.tsx` (all ten modal views).
- Isolation: `importBoundaries.test.ts` (no apps/tui imports, only linked
  @wosm packages, no local ported fork, no `focusable`).

## Command dispatch (client plan PR 4)

Live mode dispatches through the single shared `@wosm/client` service: one
`ObserverService` feeds both runtime state and commands
(`sources/observerWosmClient.ts`). Its service facet routes reconcile and
operation snapshot loads through the client runtime (dashboard-core's
`bridgeOperationService`) so the runtime's reducer base stays converged with
the store and the connected transition plus recovery toast arrive via the
state subscription — the seam from PR #78 review finding #3. Dispatch and
command-completion waits pass through unchanged; row-activate focus,
jump-to-session on click, and `Z` refresh are live
(`store/wosmCommandDispatch.test.ts`).

Mock mode keeps the rejecting service by design
(`store/stubObserverService.ts`): mutating commands run the shared operations
paths (pending rows, TTL revert, toasts) and resolve as rejected receipts
naming mock mode.

Known gap: Station's runtime runs without `createObserverBridgeHooks`, so
`command.failed` event notices do not surface as toasts; failures still toast
through the command-completion waits on the focus and operation paths.

## Known not-yet

- Footer hint chips and help rows are not click targets (routing supports
  `footerHint` and is tested; the footer renders as one truncated string).
- Top-row widgets (time/weather) are not rendered; the responsive header
  drop logic is shared and tested.
- The attention marker is static red `!` per the visual notes
  recommendation (pulse deferred).
