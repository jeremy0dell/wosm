# WOSM Competitive Backlog

Status: active product-priority note.

This note reframes the backlog around how WOSM can win against adjacent
terminal-agent tools such as workmux and Herdr. It is not a replacement for the
implementation plans under `docs/planning/active/`; it is the prioritization
layer above them.

## Product Thesis

WOSM should not compete as "tmux plus worktrees plus agent panes." That category
already exists.

WOSM should compete as the recoverable, observable, provider-neutral control
plane for serious local multi-agent terminal work.

The winning product loop is:

```text
create isolated agent work
watch all work from one cockpit
focus only when needed
recover lost sessions
understand stale or failed state
review, merge, or remove safely
```

The default setup can be opinionated and fully supported. The underlying
terminal, worktree, harness, and repository systems should remain provider
boundaries.

## What Is Table Stakes

These features matter, but they are not enough to differentiate WOSM by
themselves:

- create a worktree for a task
- open an agent in a terminal workspace
- show a list of active agents
- focus a pane/window
- send or paste a prompt
- remove a worktree
- show basic branch diff stats
- support several popular harness CLIs

If WOSM only catches up on this list, it will look like a late workflow clone.

## Winning Wedges

### 1. Explainable Runtime State

Every row should be able to answer:

```text
why am I here?
what is WOSM confident about?
what is WOSM unsure about?
what evidence backs that state?
what should the user do next?
```

Backlog implications:

- Make row state labels precise and provider-neutral.
- Add row-level debug/inspect after the CLI debug surface is strong enough.
- Keep `unknown` subdued unless there is a concrete warning reason.
- Surface stale terminal, missing hook, missing provider, and failed command
  reasons as user-facing state, not hidden logs.

Existing related plans:

- `docs/diagnostics.md`
- `docs/planning/active/session_resume_agent_recovery_plan.md`
- `docs/planning/completed/harness_socket_ingress_and_observer_queue_plan.md`
- `docs/planning/active/tui_dashboard_visual_notes.md`

### 2. Explainable Recovery

Recovery is a strong wedge only when it is explainable. Adjacent tools can
resume native sessions too, so WOSM should not claim uniqueness here. WOSM
should be excellent when a terminal tab closes, the observer restarts, a pane
dies, or a harness process exits because it can explain what happened, what
evidence exists, and what resume action is safe.

Backlog implications:

- Prioritize `session.resumeAgent` as a vertical product slice.
- Preserve provider-native session identifiers behind harness boundaries.
- Let dead tmux panes become recoverable rows when there is safe evidence.
- Reject ambiguous recovery instead of silently starting a new blank agent.
- Make recovery visible in the TUI as an explicit action, not a hidden fallback.
- Tie recovery attempts to command ids, trace ids, row evidence, and debug
  bundles.

Existing related plan:

- `docs/planning/active/session_resume_agent_recovery_plan.md`

### 3. Productized Semantic Harness Observation

WOSM already has `HarnessEventReport`, queued observer ingress, status
projection, and Codex/OpenCode event mapping. Workmux-style status support
proves the value of harness-specific hooks; WOSM's advantage should be making
the normalized observer pipeline reliable and visible after those hooks fire.

Backlog implications:

- Verify real-lane Codex and OpenCode behavior, not only contract and unit
  coverage.
- Keep status-bearing events projected into semantic row/session state.
- Preserve non-status provider events as diagnostics without polluting row state.
- Ensure `nativeSessionId`, worktree, session, and terminal correlations are
  consistently populated when providers expose them.
- Decide whether command-hook process overhead is acceptable after profiling the
  current `wosm-ingress` path.
- Treat terminal/process observation as liveness evidence and harness events as
  semantic state evidence.

Existing related plans:

- `docs/planning/completed/harness_socket_ingress_and_observer_queue_plan.md`
- `docs/planning/completed/opencode_harness_integration_plan.md`
- `docs/harness-ingress.md`

### 4. Legible Power-User TUI

Adjacent tools can be powerful but visually dense and self-referential. WOSM can
win by making the next valid operation obvious without slowing expert use.

Backlog implications:

- Keep the dashboard as the cockpit, not a mirror of the tmux workspace.
- Keep visible row slots stable for visible actionable rows only.
- Make the footer context-aware and short.
- Use help and command overlays for discoverability.
- Avoid printing terminal topology on normal rows.
- Earn density progressively through overlays, details, and row metadata.

Existing related plans:

- `docs/planning/active/tui_dashboard_visual_notes.md`
- `docs/planning/completed/tui_screen_driven_state_transition.md`
- `docs/tui.md`

### 5. Safe Operations And Cleanup

Power users will trust WOSM if destructive operations are conservative,
auditable, and easy to recover from.

Backlog implications:

- Keep remove/cleanup flows explicit about what they will touch.
- Separate UI session reset from workbench/session cleanup.
- Tie command failures to trace ids, command ids, and debug bundles.
- Never hide a destructive action behind a convenience shortcut.

Existing related references:

- `docs/debugging.md`
- `docs/local-use-checklist.md`
- `docs/manual-smoke.md`

### 6. Setup That Feels Finished

The default path should be simple enough that users do not need to understand
providers before seeing value.

Backlog implications:

- Make one supported setup path boring and excellent.
- Treat tmux and Worktrunk as reference defaults, not permanent doctrine.
- Add explicit rendering/emoji capability checks for host terminals.
- Consider auto-entering the managed terminal workspace from bare `wosm`, with
  a clear no-auto-tmux escape hatch.
- Keep `wosm doctor` as the proof that the machine is ready.

Existing related references:

- `docs/install.md`
- `docs/system-dependencies.md`
- `docs/known-issues.md`

## Priority Order

1. Make the TUI legible and discoverable enough to use locally daily.
2. Productize semantic harness observation for Codex and OpenCode.
3. Ship explainable recovery as the signature wedge.
4. Add row-level inspect/debug once the evidence model is strong.
5. Tighten setup into one excellent reference path.
6. Expand provider substrate choices only after the default path is excellent.

This order deliberately avoids starting with broad provider abstraction work.
Provider boundaries matter, but the product wins only when the default workflow
feels obviously better.

## Non-Goals

- Do not chase every feature in adjacent tools.
- Do not make flexibility the main pitch before the default path feels complete.
- Do not expose raw provider payloads in ordinary TUI surfaces.
- Do not make the management UI a dense terminal-pane layout by default.
- Do not require public release packaging before the local use loop is
  compelling.

## Manual Verification Shape

The competitive local-use loop should eventually be this:

```text
wosm doctor
wosm
N create a background agent worktree
watch the row move through starting -> working -> idle/needs attention
select the visible row slot to focus
kill or close the pane
return to WOSM and recover the prior native session
D inspect why a row is stale or blocked
X remove a disposable worktree with an explicit safety summary
```

If that loop is smooth, WOSM has a credible wedge even in a crowded category.
