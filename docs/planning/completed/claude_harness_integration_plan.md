# Claude Code Harness Integration Plan

**Status:** Complete (M0–M7 landed; deterministic gate `pnpm test:all` green; opt-in real lanes `pnpm test:e2e:claude:real` and the real e2e Claude lifecycle/hooks tests verified locally against claude 2.1.173)
**Date:** 2026-06-11
**Applies to:** Claude Code harness provider, Claude Code hook event capture, observer harness event ingress, provider-hooks ingress bin, setup/doctor surfaces, deterministic tests, real-provider lanes
**References:** `docs/architecture.md`, `docs/harness-ingress.md`, `docs/naming.md`, `integrations/harness/codex/`, `integrations/harness/cursor/`, `integrations/harness/opencode/`, `docs/planning/completed/opencode_harness_integration_plan.md`

Adds `claude` (Claude Code CLI) as a harness provider so (1) the observer sees the state of wosm-created claude sessions and (2) the TUI can spawn claude sessions. The TUI and observer core are provider-id-generic; the change is a new `integrations/harness/claude/` package plus known registration points. Transport is codex/cursor-style command hooks (`wosm-ingress claude` → `HarnessEventReport`); the installed hook event set and status projection are both derived from a single `ingressRules.ts` table per `docs/harness-ingress.md`.

## 1. M0 Spike Findings (claude 2.1.173, 2026-06-11)

Captured fixtures: `integrations/harness/claude/test/fixtures/*.json` (one redacted real payload per event variant).

### Hook injection (decides D2)

- Hooks supplied via `--settings <file>` **fire in both interactive and `-p` mode** and **merge additively** with user/project settings hooks (both sources fired in the same session).
- `--settings`-supplied hooks did **not** trigger a hook trust review dialog.
- Inline JSON (`--settings '{"hooks": ...}'`) also works. File-based artifact chosen as primary (keeps argv/pane command clean; the hook script must be installed on disk anyway). Inline JSON remains a fallback.
- **Invalid settings JSON in `-p` mode is silently ignored** (run succeeds, zero hooks, exit 0) — confirmed empirically. A `--settings` path pointing at a **missing file** is silently ignored the same way (confirmed during M3). `wosm hooks doctor claude` must re-validate the generated settings file, and the real-lane hook-capture test is the end-to-end tripwire.
- The generated artifact shape (`type: "command"` entries with `timeout: 30` and `statusMessage: "Notify wosm"`) validates and fires in claude 2.1.173 — confirmed by running real claude against the artifact produced by `expectedClaudeHookSettings` (M3 smoke).
- **Decision: D2 primary strategy confirmed** — launch-scoped `--settings <stateDir artifact>`; the user's `~/.claude/settings.json` is never touched.

### Identity (confirms D3)

- `WOSM_*` launch env is visible inside hook command processes (captured in every payload's env).
- Native `session_id` churns exactly as predicted: `/clear` emits `SessionEnd(reason:"clear")` + `SessionStart(source:"clear")` with a **new** session id; `--resume` keeps the old id with `SessionStart(source:"resume")`.
- **Decision: env-first correlation; native session id is metadata only (`nativeSessionId`); no `--session-id` in v1.**

### Trust dialog

- First interactive launch in a fresh dir shows the workspace trust dialog; **zero hook events fire until it is accepted**, then `SessionStart(source:"startup")`. Until then the run shows `unknown/low` from terminal-bound discovery — honest display, no code change needed. `-p` mode skips the dialog.

### Permission flow (decides the needs_attention source)

- `PermissionRequest` fires immediately when a tool needs approval (payload: `tool_name`, `tool_input`, `permission_suggestions`, `permission_mode`; no `tool_use_id`) and an exit-0/no-stdout command hook does **not** alter the flow — the interactive dialog still appears and waits. **Observe-safe: confirmed.**
- `Notification(notification_type:"permission_prompt", message:"Claude needs your permission")` arrives ~30s into a pending dialog — reinforcement signal.
- Approval recovery edge works: approve → `PostToolUse` → `Stop`.

### Stop / interrupt / idle

- `Stop` carries `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`. Normal turn end: `stop_hook_active:false`.
- **Esc interrupt fires no `Stop`** (only the turn's `UserPromptSubmit` remains) and **no idle `Notification` arrived within 90s** of sitting idle afterwards. Known v1 limitation: after a user interrupt the row stays `working/medium` until the next prompt/turn. Acceptable — the user interrupted the pane they are looking at. A staleness damper is a possible follow-up.
- **`SubagentStop` fires after `Stop` at turn end** (observed consistently in interactive sessions). Forwarding it as `working` would flip a freshly idle row back to working. **Decision: SubagentStop, SubagentStart, and PostToolUseFailure are NOT in the v1 rule table** (not installed, structurally dropped).

### Event payload shapes (fixtures are authoritative)

- Common fields: `session_id`, `cwd`, `transcript_path`, `hook_event_name`; most post-start events add `permission_mode`.
- `PostToolUse` uses **`tool_response`** (not `tool_output`) and adds `duration_ms`.
- `SessionEnd.reason` observed values: `clear`, `prompt_input_exit`, `other` (binary also carries `logout`).
- Headless `-p` sessions emit the full lifecycle (SessionStart → UserPromptSubmit → tools → Stop → SessionEnd(reason:"other")).

### Health / auth

- `claude --version` → `2.1.173 (Claude Code)`; fast, offline — the `health()` probe.
- `claude auth status` emits clean JSON (`loggedIn`, `authMethod`, `apiProvider`, `subscriptionType`) and exits fast — the `claude.auth` doctor check. `--version` succeeds while logged out, so health alone must not be read as launchability.
- Minimum supported version: **2.1.x baseline (2.1.173 verified)**; below-min policy: doctor warns, health stays version-string-based.

## 2. Ingress rule table (final for v1)

All sources `harness_event`. Events absent from the table are never installed into the generated settings → structurally dropped before any process spawns.

| hook event | status intent / confidence | notes |
|---|---|---|
| `SessionStart` | starting / high | all sources (`startup`/`resume`/`clear`); source recorded in providerData |
| `UserPromptSubmit` | working / medium | |
| `PreToolUse` | working / medium | |
| `PostToolUse` | working / medium | recovery edge after permission approval |
| `PermissionRequest` | needs_attention / high | observe-safe (verified) |
| `Notification` | needs_attention / high (`permission_prompt`); idle / medium (`idle_prompt`); otherwise no status | keyed on `notification_type` |
| `PreCompact` | working / medium | |
| `Stop` | idle / high (`stop_hook_active:false`); working / medium (`stop_hook_active:true` — a user Stop hook forced continuation) | |
| `SessionEnd` | exited / high for `reason != "clear"`; **no status for `reason:"clear"`** | `/clear` is followed immediately by `SessionStart(source:"clear")` |

Dropped (not installed): `SubagentStart`, `SubagentStop` (fires after `Stop`; would flip idle→working), `PostToolUseFailure`, statusline/file events.

## 3. Design decisions (carried from the approved plan, post-spike)

- **D1** Transport: command hooks → generated `wosm-claude-hook.sh` (env-guarded: exit 0 unless `WOSM_SESSION_ID` && `WOSM_WORKTREE_ID`) → `wosm-ingress … claude` → compaction → `HarnessEventReport` → `observer.harnessEvent.report` with auto-start + spool fallback.
- **D2** Launch-scoped `--settings <stateDir>/hooks/wosm-claude-settings.json` (confirmed). Marker-based JSON editor still ships for doctor stale-global-entry scanning. Never write `.claude/settings.local.json` into worktrees; never use `--bare` (disables hooks).
- **D3** Env-first identity (confirmed). Run id `claude:<terminalTargetId>`.
- **D4** No transcript parsing; `transcript_path` is an opaque providerData breadcrumb.
- **D5** No `hookAdapter.ts` / no `defaultProviderHookAdapters` registration (zero production consumers; active cleanup audit proposes deleting that surface). Cursor precedent: direct sender/command branches.
- **D6** `health()` = `claude --version`; `doctorChecks()` = `claude.version`, `claude.auth` (`claude auth status`), `claude-hooks` (artifact drift + generated-settings re-validation + stale-global scan).
- **D7** Interactive default; exec = `-p <prompt> --output-format stream-json --verbose` (hooks confirmed firing in `-p`). wosm `permissionMode:"yolo"` → `--dangerously-skip-permissions`; `profile` → `--agent`.
- Privacy/compaction: `prompt`, `tool_input`, `tool_response`, `last_assistant_message`, and `Notification.message` free text are replaced with byte-count placeholders before crossing the socket; `permission_suggestions` reduced to rule counts; `background_tasks`/`session_crons` reduced to counts.

## 4. Milestones

- **M0 — Spike + fixtures.** DONE (this section).
- **M1 — Scaffold + launch + provider skeleton.** Package, errors, launch, classify, provider (ingest stubbed), build plumbing, `observerProviders.ts` branch + test case. Gate: build/typecheck/lint/unit green; claude listed in TUI AgentPicker; `session.create` launches claude in the pane.
- **M2 — Rules + events + compaction + scope.** From fixtures; `ingestEvent` wired. Gate: rule-coverage, noisy-drop, correlation, compaction-privacy, report-validity tests green.
- **M3 — Hook install machinery + wosm-ingress + hooks CLI.** stateDir artifacts, sender/command branches + tests, `claudeHooks.ts` + main.ts dispatch + integration test, `--settings` injection, doctor checks.
- **M4 — Setup + boundaries + observer integration test.** Setup unions (model/checks/planner/configWriter/guided/render/harnessInstall) + fixtures, boundary denylists, `reconcile-claude-harness.test.ts` (incl. `reason:"clear"` does not exit). Gate: `pnpm test:all`.
- **M5 — Diagnostics.** `claude-provider.test.ts` debug-bundle + redaction.
- **M6 — Opt-in real lanes.** `tests/agent/real/claude/` (+ hook-capture version-skew tripwire), vitest config + root script, `tests/support/real-wosm` extensions, real e2e lifecycle/hooks lanes, live ingress profiling.
- **M7 — Docs sweep** and move this plan to `docs/planning/completed/`.

## 5. Known v1 limitations

- After a user Esc-interrupt, no hook fires; the row stays `working/medium` until the next turn (no idle Notification observed in 90s). Possible follow-up: staleness damper.
- Hook config is cached at claude session start: hook install/uninstall affects sessions started afterward only.
- The workspace trust dialog gates all hooks on first launch in a fresh worktree; until accepted the run shows `unknown/low`.
