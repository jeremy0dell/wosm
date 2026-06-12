# Station Dashboard: Target Architecture And Sequencing

Status: active plan
Date: 2026-06-12
Scope: the apps/tui ↔ Station seam — end state and the ordered path to it.

Companion documents:

- `wosm_station_spike.md` — the spike this serves (decision target 2026-06-24)
- `station_tui_overlay_seams_review.md` — the read-only seams review whose
  judgment this plan adopts
- `experimental/station/apps/station/src/wosm/ported/PROVENANCE.md` — the
  staging ledger this plan retires (retired in step 3: the `ported/` tree is
  deleted and `packages/dashboard-core` is the single source)

## Where this came from

PR #78 shipped the Station WOSM view at apps/tui popup parity by porting the
TUI's render-framework-free logic layer verbatim (`src/wosm/ported/`) and
rewriting only the render layer in OpenTUI. That was a deliberate staging
choice: parity by construction now, extraction later. Two independent reviews
(the multi-agent code review of PR #78 and the seams review) converged on the
same judgment: the boundary is right, the copy is acceptable staging, and it
must not become the permanent shape. The `station-tui-seams-review` branch has
since made "later" concrete by implementing the extraction end-to-end.

## Target architecture

One dashboard machine, two render adapters:

```text
packages/dashboard-core/            single source of dashboard truth (render-free, root CI)
  state/        transition machine, screens, operations, toasts, localRows
  selectors/    viewport math, filtering, slot choices
  flows/        newSession, addProject, stepWizard
  layout/       row constraint solver, dashboard/help/sheet/toast geometry
  content/      every user-facing string: headers, footers, prompts, help, toasts
  keymap/       binding tables as data + the shared key vocabulary

apps/tui/                           Ink adapter only
  components/   thin Ink renderers over dashboard-core
  (Ink input normalization -> shared key type at the edge)

experimental/station/.../src/wosm/  OpenTUI adapter only
  view/         OpenTUI renderers over dashboard-core
  input/        sequence->key translation, overlay keymap layer, routeWosmMouse
  store/        thin wiring: dashboard-core machine + StationWosmClient
  sources/      StationWosmClient factory ({state, service} facets; live mode
                builds both from ONE ObserverService / client runtime)

ported/                             deleted
```

Load-bearing principles:

- Behavior AND copy live in the core. A user-facing string in a view layer is
  a drift bug — the PR #78 review's two medium findings (toast and prompt
  copy re-authored in `view/`) were exactly this class.
- Each app translates its raw input into the shared key vocabulary at its own
  edge (Ink parsed keys; Station legacy byte sequences) and renders what the
  core decides. Keymap tables are introspection data over the machine; help
  and footer chrome derive from them.
- One client boundary per app. `StationWosmClient` exposes `{state, service}`
  so command dispatch (client plan PR 4) shares the live `ObserverService`
  with state instead of opening a second socket client. Mock mode pairs the
  fixture source with the rejecting stub service, identity-free downstream.
- Station keeps what is genuinely Station's: coordination store, input
  router, panes, PTY runtime, popup geometry.
- `dashboard-core` joins the root workspace and CI; Station consumes it
  through the link script exactly like client/contracts/runtime. Station
  itself stays out of root CI until promotion.

## Sequenced plan

1. **Patch and merge PR #78** (done — merged 2026-06-12):
   - sanitize overlay paste (strip control bytes; newlines become spaces)
     and honor the dispatch outcome, so paste can never inject what the
     keyboard path filters
   - first paint uses the popup `rows` prop directly instead of waiting for
     the store's `terminalRows` effect to catch up
   - restore the upstream comment in the adapted `reconcileSnapshot` naming
     the connected-transition responsibility (a PR 4 seam, deliberately not
     "fixed" here — status is the source bridge's to own)
   - root `test` wrapper in `experimental/station/package.json` so the
     documented acceptance command works from the documented directory
   - finish the adapted-extraction pattern for the two views holding copied
     upstream logic: toast presentation -> `ported/components/ToastOverlay/
     content.ts`, command-prompt lines -> `ported/components/Dashboard/
     content.ts`, both under the PROVENANCE audit

2. **Land the station-side half of `station-tui-seams-review` as its own PR**
   (done — PR #79, merged 2026-06-12; its enforced parity test caught and
   re-synced real PR #77 drift in the ported tree on landing): StationApp extraction + rendered
   composition test, enforced `portedParity.test.ts` (upgrades the manual
   PROVENANCE diff to a failing test), `createWosmViewStore` flow tests,
   the `StationWosmClient` boundary, app-neutral `@wosm/client` messages.
   Low risk; puts guardrails on the copy while it exists; makes Station
   PR-4-ready.

3. **Review the extraction trio as a separate PR with a hard bar**
   (done — PR #80, merged 2026-06-12): the
   apps/tui pure-helper extraction, keymap-metadata move, and
   `packages/dashboard-core`. This is the parity-by-mechanism move — and the
   only step that can regress production apps/tui, which the spike's
   invariants forbid. Bar: apps/tui transition/golden suites untouched and
   green; root CI green with the new package; Station link script gains
   dashboard-core; `ported/` deleted. Timed against the 2026-06-24 spike
   decision — this PR effectively IS the promotion-architecture decision.

4. **Client plan PR 4 (command dispatch) on the unified boundary**
   (done — 2026-06-12): swap the
   stub service for the live `ObserverService` shared with the state runtime;
   route reconcile through the client runtime so the connected transition and
   recovery toast arrive via the subscription (resolving the seam noted in
   step 1); un-stub row-activate focus, Z refresh, and jump-to-session.
   As built: the service swap had already landed with step 2's boundary
   unification, so this step's substance was the seam fix — the live client's
   service facet is now `bridgeOperationService(rawService, runtime)`, routing
   reconcile and operation snapshot loads through the client runtime — plus a
   behavioral suite (`wosmCommandDispatch.test.ts`) pinning focus dispatch,
   jump-to-session, Z-through-runtime, a convergence regression, and the
   reconcile-driven connected transition with recovery toast. Mock mode keeps
   the rejecting service; its copy names mock mode instead of the gate.
   Details in the client plan's PR 4 section.

5. **Polish where the code lands** (post-extraction so nothing is done
   twice): theme tokens for hover/backdrop colors, shared QUIT_HINT, a
   parameterized test-store factory, the derived no-op-binding predicate in
   the keymap coverage test, probe-key hoist, scenario-builder cleanup. Then
   the known not-yets: footer-hint click targets, top-row widgets, attention
   pulse — small PRs against dashboard-core.
   Status: the polish findings (ledger #8, #10–#15) landed 2026-06-12 in one
   pass; the feature not-yets remain open. The source-bridge fix (#8) landed
   red-first with dashboard-core's first own unit suite
   (`packages/dashboard-core/test/unit/sourceBridge.test.ts`).

Coordination rule: #78 is patched first; the seams branch rebases once on
top; the extraction trio stays parked until the station-side half is in.

## PR #78 review findings ledger

15 findings survived adversarial verification (union of both review passes).
Disposition:

| # | Finding | Disposition |
|---|---|---|
| 1 | Overlay paste bypasses control-byte filtering | fixed in #78 |
| 2 | First paint uses stale store terminalRows | fixed in #78 |
| 3 | Adapted reconcile drops connected-transition responsibility | fixed in PR 4 (step 4, 2026-06-12) |
| 4 | wosm input paths lack dialogStack guards (latent; no producer exists) | with the first dialog feature; guard all three paths symmetrically + test |
| 5 | Sheet width math counts code units, not display width (upstream-faithful) | fix upstream first, then re-port (step 3 makes this one fix) |
| 6 | Toast copy duplicated in view, outside the drift audit | fixed in #78 |
| 7 | Prompt copy duplicated in view, outside the drift audit | fixed in #78 |
| 8 | sourceBridge failure arm re-renders on content-identical updates | fixed in the step-5 polish pass (2026-06-12) |
| 9 | Documented test command broken from documented directory | fixed in #78 |
| 10 | QUIT_HINT duplicated; string pinned by ported footer comparison | fixed in the step-5 polish pass (2026-06-12) |
| 11 | Hover/backdrop colors hardcoded outside theme | fixed in the step-5 polish pass (2026-06-12) |
| 12 | Test store builder duplicated across four suites | fixed in the step-5 polish pass (2026-06-12) |
| 13 | Hand-maintained no-op allowlist derivable from binding data | fixed in the step-5 polish pass (2026-06-12) |
| 14 | probeKeys() re-allocated ~39x per coverage run | fixed in the step-5 polish pass (2026-06-12) |
| 15 | Scenario builder ternary density / duplicated confidence expr | fixed in the step-5 polish pass (2026-06-12) |

## Do not do

Carried over from the seams review, still binding:

- Do not import `apps/tui` or `@wosm/tui` into Station to remove the copy.
- Do not add Station to root workspace/build/CI before promotion.
- Do not move Station PTY/renderer/OpenTUI code into shared packages during
  the spike.
- Do not start command dispatch with a second live observer client beside
  `@wosm/client`.
