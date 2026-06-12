# Station VT Engine Decision

**Status:** Decided and implemented
**Date:** 2026-06-12
**Scope:** `experimental/station/apps/station/src/terminal/`
**Role:** Secondary Goal B viability memo for the
[Station spike](wosm_station_spike.md)

## Decision

Station's terminal panes parse PTY output through `@xterm/headless@6.0.0`
(pinned) plus `@xterm/addon-unicode11`, wrapped in a Station-local store
(`src/terminal/vt/screen.ts`) and rendered by a direct-buffer OpenTUI
renderable (`src/terminal/TerminalScreenRenderable.ts`).

**The engine does not escape `vt/`.** `StationVtScreen` exposes only an
engine-agnostic view — `buildRows()`, `isBracketedPasteEnabled()`,
`rowText()`, `cursor()`, `isAltScreen()`, `bufferStats()` — plus a
documented test/diagnostic-only `unsafeEngine` escape hatch. The renderable,
the pane, and the conformance assertions all consume the view, which makes
the 37-case conformance catalog an engine acceptance suite: a candidate
engine swap is `vt/screen.ts` + `vt/rows.ts` internals, validated by
re-running the same catalog.

Module layout is concern-first: `input/` (key/paste routing, kitty CSI-u
translation), `pty/` (node-pty bridge transport), `vt/` (engine + screen
math), with `TerminalPane.tsx` and `TerminalScreenRenderable.ts` prominent
at the `terminal/` root.

## Why @xterm/headless

Researched 2026-06-11/12 via four parallel research branches plus empirical
probes under Bun 1.3.13 (all capabilities verified before adoption):

- The exact pipeline (node-pty -> headless xterm state -> styled cells ->
  React TUI) ships in production in VS Code's pty host (terminal
  persistence + the 2026 Copilot agent-host headless terminals),
  google-gemini/gemini-cli (Ink), and ccmanager.
- ~574k weekly npm downloads; maintained by the xterm.js team with
  near-daily 6.1.0 betas (VS Code pins the beta channel).
- Pure JS: no native prebuilds, no Zig/N-API toolchain, works in Bun
  unmodified.
- Stable buffer/parser API across majors (v6 breaking changes were all
  browser-side).

### Alternatives evaluated and rejected (for now)

| Path | State at decision time |
|---|---|
| `@coder/libghostty-vt-node` | 0.1.0-beta, ~349 weekly downloads, all commits on one day, drops inverse/dim/strikethrough from snapshots, pre-bakes ghostty palette hex; Coder's own Mux uses @xterm/headless instead |
| `libghostty-vt` npm (Prime Radiant bun:ffi) | Full attribute fidelity and dirty tracking, but 0-star single-vendor days-old "published for experimentation", Bun-only |
| `ghostty-web` WASM headless | Headless mode is an open unmerged issue (#95); DOM-free inner layer is undocumented internal API over a non-upstream WASM patch |
| Upstream libghostty-vt | Untagged, header says API "is definitely going to change"; missed its 6-month GA target |
| asciinema `avt` (Rust/WASM) | Battle-tested but no npm package, no query responses, would need vendoring + custom wrapper |
| Write our own | Calibration: avt is ~7.5k lines over 7 years and still fixed wide-char bugs in 2026; the spike plan lists "expanding into a terminal emulator rewrite" as a kill signal |

### Swap path

The libghostty ecosystem has momentum among new agent-terminal products
(Herdr vendors it from Rust; openmux uses it on the same Bun+OpenTUI stack;
xterm.js itself is exploring adopting it as core in xtermjs/xterm.js#5686).
If a binding matures past beta, the swap surface is `vt/screen.ts` +
`vt/rows.ts`; everything above consumes `StationVtScreen`/`VtRow` and does
not know the engine.

## Engine gaps we paper over (verified, tested)

- **OSC 10/11 color queries are unanswered by headless xterm** (the replying
  ThemeService is browser-only). termenv/lipgloss-based TUIs (opencode) wait
  on these for background detection. `vt/screen.ts` answers with Station's
  theme; `vt/screen.test.ts` is the executable proof.
- **DECTCEM cursor visibility is not exposed** by the headless buffer API;
  tracked via parser handlers (`?25h/l`, plus RIS/DECSTR restoring
  visibility).
- **Query replies surface only on `terminal.onData`** and must be written
  back to the PTY (DA1/DA2/DSR/CPR/DECRQM). Crossterm (codex) blocks on DA1
  at startup without this.
- **Default Unicode 6 widths** disagree with OpenTUI's measurement around
  emoji; `@xterm/addon-unicode11` aligns them. ZWJ clusters still render as
  separate wide cells (no mode-2027 grapheme clustering); pinned by test.
- **XTGETTCAP is unanswered** (xterm.js-wide gap, also true in VS Code);
  apps fall back after their probe timeout.
- BLINK is deliberately stripped at the span layer (policy).

## Effect boundary posture

Per `docs/architecture.md` Boundary Rules and
`docs/planning/active/effect_boundary_hardening_sequence.md` section 1, each
touched boundary chose a posture explicitly:

| Module | Posture | Reason |
|---|---|---|
| `vt/rows.ts`, `vt/theme.ts`, `vt/kittyToLegacy.ts` | plain TypeScript | pure transforms (cell->span, palette math, sequence decoding) — the rubric's named plain category |
| `vt/screen.ts` | plain TypeScript | subscription store matching the existing station source shape; its single timer is render-coalescing cadence, not timeout/retry/cancellation plumbing |
| `nodePtyTerminal.ts` + `nodePtyBridge.cjs` | plain TypeScript, explicitly chosen | process lifecycle + backpressure only; no retry, no Promise.race timeouts, no polling loops (inventory-guard red flags absent). The bridge is a dependency-free CJS file executed by `node` directly |
| Observer/protocol IO | n/a here | Station consumes `@wosm/client`, which already sits on the hardened Effect layers |

The station experiment intentionally has no `effect` dependency; adding one
would cut against the spike's dependency-isolation goal.

## Test evidence map

| Claim | Evidence (all under `src/terminal/`) |
|---|---|
| renders correctly | `vt/conformance.test.ts` + 37-case catalog in `vt/cases/` (SGR, cursor/erase, alt-screen, DECSTBM, wrap/wide, scrollback, charset); `TerminalPane.test.tsx` frame-level assertions via the OpenTUI test renderer |
| resize | screen resize unit tests; frame tests "resize reaches the pty at the new interior size" and "shrinking leaves no stale cells"; smoke `stty size` static + live |
| edge cases | split-CSI chunks, pending wrap, wide char at last column, ZWJ pin, BCE, region-scroll scrollback isolation, query round-trips, write-after-exit, degenerate resize, garbage bridge commands, burst coalescing |
| real processes | `ptyPipeline.smoke.test.ts` (gated `WOSM_STATION_PTY_SMOKE=1`): real shell SGR -> styled span, live resize, alt-screen round-trip, real `vi` (extra-gated `WOSM_STATION_PTY_SMOKE_TUI=1`) |
| transport resilience | `bridgeHardening.test.ts` (gated): full final burst + real exit code, stdin-close cleanup, error replies to garbage commands |
| throughput | `vt/screen.stress.test.ts`: burst coalescing, scrollback cap; gated 4MB feed + 200x50 styled rebuild (median ~0.2ms vs 10ms budget) |

Lanes: `bun run test` (hermetic default), `bun run test:pty` (host lane;
needs node for the sidecar), `bun run test:stress`. Station remains excluded
from root `test:all`/CI by design. Known follow-up: the container image
(`oven/bun`) lacks node, so the PTY lane is host-only until node is added to
the Dockerfile.

## Adversarial review outcome (2026-06-12)

A 26-agent review workflow (4 dimensions, every finding independently
refutation-checked) confirmed 17 findings; all code findings are fixed:
stale pending-resize after bounce-back (P1), kitty keypad/punctuation/digit
translation gaps, out-of-range code-point throw, chord alternate-variant
leak (chords now match after legacy translation in `src/appInput.ts`),
bridge SIGTERM backstop + `stdin.end()` on dispose + post-dispose data-
buffering guard, pause-window cap vs node-pty's 200ms socket destroy,
honest signal exit codes, imperative session dispose on Ctrl-Q (React
unmount work cannot flush before `process.exit`), rgba cache cap, and
cursor visibility on wide-char continuation cells. Test-debt findings
added: paste-pipeline coverage, resize-storm trailing-edge coverage, and
DECSC/DECRC + DECOM + IRM + RI conformance cases.

End-to-end input proof (`src/appInput.e2e.test.tsx`): keystrokes go through
OpenTUI's real input pipeline and the production sequence handler into the
pty as legacy bytes (kitty mode included), and — in the
`WOSM_STATION_PTY_SMOKE_TUI=1` lane — real `claude` and `codex` sessions
are launched by typing into the pane, paint their TUIs, quit on double
Ctrl-C, and leave a usable shell. Lane: `bun run test:agents`.

## Deferred

Mouse forwarding to panes (`terminal.modes.mouseTrackingMode` is the
signal), OSC title surfacing, OSC 52 clipboard, scrollback viewing/copy
mode, full ack-based flow control (bridge stdout backpressure pause/resume
covers v1), env scrubbing of outer-terminal markers, synchronized-output
mode 2026 flush gating, 6.1.0-beta channel for kitty-keyboard query
answers. From review: gated tests report pass instead of skip (bun
`skipIf` would make skips visible), and the renderable's width-clip guard
lacks a dedicated mutation test (needs a directly-constructed renderable
with a wider screen).
