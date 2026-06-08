# Session Resume Agent Recovery Plan

**Status:** Planning
**Date:** 2026-06-02
**Applies to:** session commands, observer recovery state, provider contracts, harness integrations, tmux terminal launch, TUI row actions
**References:** `docs/architecture.md`, `docs/development.md`, `docs/debugging.md`, `packages/contracts/src/commands.ts`, `packages/contracts/src/providers.ts`, `apps/observer/src/commands/session/startAgent.ts`, `integrations/harness/{codex,opencode,pi}/src/launch.ts`

This plan records the current research and proposed vertical slice for resuming agent sessions after the WOSM UI, observer, terminal pane, or harness process loses the live agent.

The target is a narrow recovery feature. It should let WOSM restart a provider-native agent session when there is enough safe evidence to do so. It should not turn observer/core into a provider-specific session parser, and it should not silently start a blank new agent when the user expected to resume the old one.

## User Goal

When a session loses its agent because the app crashes, the terminal pane dies, the observer restarts, or the harness process exits unexpectedly, WOSM should offer a way to resume the previous agent session.

The behavior should start behind config and feature-flag control. Provider-specific resume flags should stay in harness integrations because each harness has different CLI grammar.

## Current Shape

### Fresh Agent Start

`session.startAgent` is a fresh-start command:

```text
TUI no-agent row
  -> session.startAgent
  -> observer resolves project/worktree/terminal/harness
  -> observer creates a new WOSM session id
  -> terminal.openWorkspace
  -> harness.buildLaunch
  -> terminal.launchProcess
  -> reconcile and publish session.created
```

Important current behaviors:

- `session.startAgent` rejects a row that already has an agent with `SESSION_ALREADY_HAS_AGENT`.
- When no harness provider is requested, it can remember the most recently seen harness for the worktree.
- Session titles are seeded before harness launch and preserved by persistence/reconcile.
- The TUI primary row action starts a no-agent row and focuses an agent-backed row.

This is the correct fresh-start path. Resume should be a distinct command intent so callers, tests, and diagnostics can tell the difference between "start a new agent" and "resume the previous provider-native session".

### Harness Contracts

`HarnessCapabilities` already has `canResume`, but current real harnesses report it as false:

```text
codex    canResume: false
opencode canResume: false
pi       canResume: false
scripted canResume: false
```

`BuildHarnessLaunchRequest` currently has project, worktree, terminal target, WOSM session id, mode, prompt, profile, permission, approval, and sandbox fields. It has no resume target yet.

### Terminal Recovery Substrate

The tmux provider already preserves useful recovery evidence:

- WOSM identity is written into tmux window and pane options.
- Dead panes are reported as terminal targets with `state: "stale"`.
- Provider data includes role, harness, dead state, dead status, current command, pane id, window id, and worktree path.
- `launchProcess` uses `respawn-pane -k`, which can restart the harness process in the existing pane.

This means a dead tmux pane can often be used as the same terminal target for resume. If the entire terminal target is gone, WOSM needs durable recovery metadata.

### Provider CLI Grammar

Local CLI help confirmed that resume grammar differs by harness:

```text
Codex:
  codex resume [SESSION_ID] [PROMPT]
  codex resume --last [PROMPT]

OpenCode:
  opencode --session <id> [--prompt <prompt>]
  opencode --continue [--prompt <prompt>]

Pi:
  pi --session <path|id> [messages...]
  pi --continue [messages...]
  pi --resume is an interactive picker
```

Therefore WOSM should not put a raw `--resume` string in observer/core. The contract should carry a provider-neutral resume intent, and each harness adapter should turn that intent into the right command and args.

### Native Session Metadata

Provider-native session ids are already visible in parts of the hook path:

- Codex hook payloads include `session_id`; current Codex provider data stores it as `codexSessionId`.
- OpenCode observations already expose `nativeSessionId`.
- Pi event provider data stores `piSessionId` and `piSessionFile`.

Resume should normalize these into a durable provider-neutral recovery record instead of making observer/core scrape provider-specific `providerData`.

## Decision

Adopt a typed resume intent with a new observer command:

```text
session.resumeAgent
```

Do not overload `session.startAgent`.

Add resume details at the contract boundary:

```ts
type HarnessResumeTarget =
  | { kind: "native-session"; id: string }
  | { kind: "session-file"; path: string }
  | { kind: "last-for-worktree" };

type HarnessResumeOptions = {
  target: HarnessResumeTarget;
  previousSessionId?: SessionId;
};
```

Extend `BuildHarnessLaunchRequest` with:

```ts
resume?: HarnessResumeOptions;
```

The observer sends `resume` to `harness.buildLaunch`. Harness integrations decide whether they support that target and map it to provider-specific CLI flags.

## Feature Flag And Config

Add a temporary feature flag in `packages/contracts/src/featureFlags.ts`:

```ts
sessionResumeAgent: {
  defaultValue: false,
  exposure: "client",
  owner: "observer",
  surfaces: ["config", "observer", "protocol", "tui", "provider"],
  lifecycle: "temporary",
  summary: "Enable resuming lost provider-native agent sessions.",
}
```

Config usage:

```toml
[feature_flags]
sessionResumeAgent = true
```

Feature flag keys are a flat record today, so use the exact configured key unless the implementation adds explicit feature-flag key normalization.

Provider-level opt-in can stay separate if needed:

```toml
[harness.codex]
resume = true
```

That provider knob should only control whether the adapter advertises `canResume`; it should not expose raw CLI args.

## Recovery Metadata

Add a shared recovery shape, either by extending `RecoveryBreadcrumbSchema` or by adding a dedicated session recovery contract and SQLite table.

Recommended dedicated shape:

```ts
type SessionRecoveryHandle = {
  schemaVersion: 1;
  provider: ProviderId;
  projectId: ProjectId;
  worktreeId?: WorktreeId;
  sessionId?: SessionId;
  nativeSessionId?: string;
  sessionFile?: string;
  cwd?: string;
  terminalTargetId?: TerminalTargetId;
  harnessRunId?: HarnessRunId;
  observedAt: string;
  lastSeenAt: string;
};
```

Rules:

- Store ids, paths, provider names, and timestamps only.
- Do not store prompts, transcript contents, tool payloads, API keys, tokens, or secrets.
- Keep provider-private parsing inside harness integrations.
- Observer persistence can store the normalized handle, not provider-specific raw payloads.
- In-worktree breadcrumbs remain opt-in because they write inside user worktrees.

## Observer Command Flow

Target flow:

```text
TUI recoverable row
  -> session.resumeAgent
  -> observer verifies feature flag
  -> observer resolves project and current worktree
  -> observer verifies no live primary agent is running
  -> observer resolves harness provider
  -> observer verifies harness canResume
  -> observer resolves recovery handle
  -> terminal.openWorkspace or reuse stale terminal target
  -> harness.buildLaunch({ resume })
  -> terminal.launchProcess
  -> reconcile and publish session.created/session.updated
```

Validation rules:

- If a live current agent exists, reject with the same spirit as `SESSION_ALREADY_HAS_AGENT`.
- If no recovery handle exists, reject with a clear recovery-specific validation error instead of silently starting fresh.
- If the provider cannot resume, reject with `HARNESS_RESUME_UNSUPPORTED`.
- If the recovery target is ambiguous, reject. Do not guess between multiple native sessions.
- Preserve the previous WOSM session id and title when a previous session id is known and safe.
- If no previous WOSM session id is safe, create a new WOSM session id but mark the launch as resumed through the harness native handle.

## Harness Adapter Mapping

### Codex

Supported targets:

```text
native-session -> codex resume --cd <worktree> <id> [prompt]
last-for-worktree -> codex resume --last --cd <worktree> [prompt]
```

`last-for-worktree` should be disabled for automatic recovery until deterministic matching is proven. It is acceptable as an explicit user fallback later.

### OpenCode

Supported targets:

```text
native-session -> opencode --session <id> [--prompt <prompt>]
last-for-worktree -> opencode --continue [--prompt <prompt>]
```

Prefer `native-session` when the OpenCode plugin has reported a provider-native session id.

### Pi

Supported targets:

```text
native-session -> pi --session <id> [messages...]
session-file -> pi --session <path> [messages...]
last-for-worktree -> pi --continue [messages...]
```

Do not use `pi --resume` for automatic recovery because it opens an interactive picker.

### Scripted

Keep `canResume: false` initially unless a deterministic scripted scenario needs a fake resume lane for tests.

## Snapshot And TUI UX

Initial UI behavior should be conservative:

```text
no agent + no recovery handle -> start agent
no agent + recovery handle + flag on + harness canResume -> resume agent
agent exists -> focus agent
```

Do not add a new global key in the first slice. Preserve current visible keyed row choices.

The row action can show a normal pending start/resume local row while the command runs. If the TUI needs to distinguish it, use a narrow local operation type such as `resumeAgent` rather than changing persisted snapshot language first.

Later UI improvements can add explicit markers such as "recoverable" or "resume", but the first slice can keep the interaction simple and avoid broad row-render churn.

## Implementation Slices

### Slice 1: Contracts And Config

- Add `sessionResumeAgent` feature flag definition.
- Add `session.resumeAgent` command schema and payload.
- Add `HarnessResumeTarget` and `HarnessResumeOptions` schemas.
- Extend `BuildHarnessLaunchRequest` with optional `resume`.
- Add config schema support for a provider-level `resume` boolean if needed.
- Add contract and config tests.

### Slice 2: Recovery Handle Persistence

- Add a strict provider-neutral recovery handle schema.
- Normalize native session ids from Codex, OpenCode, and Pi harness events.
- Persist latest safe recovery handles by project/worktree/provider/session.
- Expose enough recovery metadata to observer command resolution.
- Keep raw provider payloads out of public snapshots.

### Slice 3: Harness Resume Launch Plans

- Add resume-aware launch-plan builders for Codex, OpenCode, and Pi.
- Turn `canResume` on only when the provider config and adapter support are present.
- Reject unsupported resume target kinds inside provider adapters with provider-specific safe errors.
- Keep provider CLI arg mapping local to each integration.

### Slice 4: Observer Command

- Add `apps/observer/src/commands/session/resumeAgent.ts`.
- Share the safe common launch plumbing from `startAgent` without merging command semantics.
- Preserve session title/id where safe.
- Reconcile and publish after launch.
- Add integration tests with fake providers and fake terminal.

### Slice 5: TUI Action

- Add command-builder support for `session.resumeAgent`.
- Select resume for recoverable no-agent rows when feature flag and capability allow it.
- Keep ordinary no-agent rows on `session.startAgent`.
- Add interaction tests around row primary action and command runtime focus options.

### Slice 6: Real E2E

- Codex: start a WOSM-launched Codex session, kill the harness process while tmux pane remains, refresh WOSM, select the row, and verify `codex resume <id>` relaunches into the same native session.
- OpenCode: repeat with plugin-reported native session id and `opencode --session`.
- Pi: repeat with `pi --session <id-or-path>`.
- Verify terminal focus works from persistent popup mode.

## Test Plan

Deterministic tests:

- Contract schema accepts `session.resumeAgent` and rejects invalid resume targets.
- Config accepts `sessionResumeAgent = true` and rejects unknown flags.
- Provider capabilities advertise `canResume` only when supported.
- Codex launch builder maps `native-session` to `codex resume <id>`.
- OpenCode launch builder maps `native-session` to `opencode --session <id>`.
- Pi launch builder maps `session-file` and `native-session` to `pi --session`.
- Observer rejects resume when feature flag is off.
- Observer rejects resume when a live agent already exists.
- Observer rejects resume when no recovery handle is available.
- Observer preserves WOSM session title when resuming a known previous session.
- TUI primary action chooses resume only for recoverable no-agent rows.

Focused gates:

```bash
pnpm test:contracts
pnpm test:unit
pnpm test:integration
pnpm test:agent:scripted
```

Real lanes:

```bash
pnpm test:e2e:codex:real
pnpm test:e2e:real:local
```

Real lanes should remain opt-in and must not become ordinary CI requirements.

## Open Questions

- Should resume preserve the exact WOSM `sessionId` or create a new WOSM session with a link to the old one when the terminal target disappeared completely?
- Should recoverable state be visible in snapshots before TUI starts using it, or should the first slice keep it command-internal?
- Should provider-level `resume = true` be required, or is the global feature flag plus adapter capability enough?
- Should `last-for-worktree` be allowed in automatic recovery, or only explicit user fallback flows?

## Manual Verification

UX implication: a crashed agent row can resume the provider-native session instead of silently starting a blank new agent.

Manual check:

1. Enable `sessionResumeAgent`.
2. Start a WOSM-launched Codex session in tmux.
3. Kill the Codex process while leaving the tmux pane/window.
4. Run `wosm reconcile` or refresh the TUI.
5. Select the affected row.
6. Confirm WOSM relaunches Codex with the previous native session id, keeps the row/title stable, and focuses the resumed terminal target.
