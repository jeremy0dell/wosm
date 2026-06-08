# OpenCode Harness Integration Plan

**Status:** Planning
**Date:** 2026-05-30
**Applies to:** OpenCode harness provider, OpenCode plugin event capture, observer harness event ingress, provider contracts, deterministic tests, real-provider lanes
**References:** `docs/architecture.md`, `docs/development.md`, `docs/debugging.md`, `docs/planning/harness_socket_ingress_and_observer_queue_plan.md`, `integrations/harness/pi/`, Herdr OpenCode integration

This plan resets the OpenCode harness integration from first principles.

The target is not a large OpenCode-specific observer subsystem. The target is a lean provider integration like Herdr's OpenCode plugin, but shaped to WOSM's observer, contracts, provider registry, status projection, diagnostics, and tests.

## 1. User Goal

OpenCode is installed and authenticated locally. It opens with:

```bash
opencode
```

WOSM should be able to:

1. Launch real OpenCode sessions through the existing observer command path.
2. Capture OpenCode plugin events while OpenCode runs under WOSM.
3. Ingest all OpenCode event types, not only the status events Herdr maps.
4. Normalize status-bearing events into WOSM agent state.
5. Preserve unknown or non-status events as provider diagnostics without breaking row state.
6. Keep provider-specific parsing and behavior inside `integrations/harness/opencode`.
7. Keep observer/core consuming provider-neutral `HarnessEventReport` records.
8. Keep deterministic CI independent of real OpenCode, credentials, tmux, Worktrunk, and network.
9. Add opt-in real OpenCode tests that exercise the real binary and real observer integration.

## 2. First Principles

### 2.1 Source Of Truth

OpenCode gives WOSM three different signal classes:

```text
terminal process evidence
  proves identity, liveness, pid, cwd, terminal target

OpenCode plugin events
  prove semantic agent state and provider-native session metadata

OpenCode CLI health/config
  proves local availability enough to launch or diagnose
```

WOSM should not treat plugin events as liveness authority. The terminal provider owns process identity and liveness. OpenCode plugin events enrich semantic status.

This matches the Herdr reference:

```text
process detection owns identity/liveness
plugin hooks report working/blocked/idle state
hook failures do not break the agent session
```

It also matches current WOSM architecture:

```text
provider-specific capture -> HarnessEventReport -> observer queue -> persistence/projection/reconcile
```

### 2.2 Observer Boundary

Observer code must not import OpenCode-specific payload schemas. The observer accepts a provider-neutral `HarnessEventReport`, queues it, persists compact observations, projects status, and schedules reconcile.

OpenCode-specific event normalization belongs in:

```text
integrations/harness/opencode/src/*
```

The OpenCode runtime plugin is allowed to know OpenCode event shapes. It is not allowed to know observer internals beyond the stable protocol request shape for `observer.harnessEvent.report`.

### 2.3 Lean Integration Bias

The OpenCode plugin should be closer to Herdr than to a full SDK:

```text
OpenCode plugin callback
  -> compact event
  -> construct HarnessEventReport
  -> send one NDJSON request over Unix socket
  -> timeout quickly
  -> optionally spool
  -> never throw into OpenCode
```

No subprocess per OpenCode event. Do not route high-frequency plugin events through `wosm-ingress` as the primary path.

## 3. External Reference Shape

Herdr writes this file:

```text
~/.config/opencode/plugins/herdr-agent-state.js
```

OpenCode automatically loads global plugin files from:

```text
~/.config/opencode/plugins/
```

The Herdr plugin subscribes to all events through:

```js
export const HerdrAgentStatePlugin = async () => ({
  dispose: async () => {},
  event: async ({ event }) => {},
});
```

It maps only semantic states:

```text
permission.asked       -> blocked
question.asked         -> blocked
permission.replied     -> working or idle
question.replied       -> working
question.rejected      -> idle
session.status busy    -> working
session.status retry   -> working
session.status idle    -> idle
session.idle           -> idle
dispose                -> release
```

WOSM should use the same OpenCode plugin mechanism but send provider-neutral reports to WOSM's observer socket instead of Herdr's pane socket.

## 4. OpenCode Event Coverage

The current OpenCode plugin docs list these event types:

```text
command.executed
file.edited
file.watcher.updated
installation.updated
lsp.client.diagnostics
lsp.updated
message.part.removed
message.part.updated
message.removed
message.updated
permission.asked
permission.replied
server.connected
session.created
session.compacted
session.deleted
session.diff
session.error
session.idle
session.status
session.updated
todo.updated
shell.env
tool.execute.after
tool.execute.before
tui.prompt.append
tui.command.execute
tui.toast.show
```

Acceptance rule:

```text
Every OpenCode plugin event type produces a valid HarnessEventReport.
Only status-bearing event types include report.status.
Unknown future event types still produce a valid diagnostics-only report.
```

## 5. Contract Strategy

### 5.1 Existing Contracts Are Mostly Sufficient

`HarnessEventReport` already supports:

```text
provider
eventType
observedAt
status?
correlation?
diagnostics?
providerData?
coalesceKey?
```

That is enough to ingest all OpenCode events without adding an OpenCode-specific contract.

### 5.2 Proposed Contract Change

Add one provider-neutral optional field for provider-native session identity:

```ts
nativeSessionId?: string;
```

Recommended locations:

```text
packages/contracts/src/hooks.ts
  HarnessEventReportCorrelationSchema

packages/contracts/src/observations.ts
  HarnessEventObservationSchema
```

Rationale:

- WOSM `sessionId` is a WOSM command/session id.
- OpenCode `properties.sessionID` is provider-native.
- Pi already has `piSessionId` in `providerData`.
- Codex has `session_id` in provider-specific payload/providerData.
- A provider-neutral `nativeSessionId` lets observer persistence, debug bundles, resume planning, and future TUI diagnostics refer to native agent sessions without scraping provider-specific `providerData`.

Rules:

```text
Do not add OpenCode-specific keys to shared contracts.
Do not rename existing sessionId.
Do not require nativeSessionId.
Preserve exactOptionalPropertyTypes: omit the field when absent.
```

If this change causes persistence churn out of proportion to the immediate value, defer it and keep `opencodeSessionId` in providerData for the first slice. The plan should still leave a TODO and test fixture for adding `nativeSessionId`.

### 5.3 No New Agent State For "blocked"

Herdr uses `blocked`. WOSM currently uses:

```text
needs_attention
```

OpenCode permission/question events should map to `needs_attention`, not a new shared `blocked` state. Adding a new agent state would touch TUI styling, snapshots, status projection, tests, and user-facing language without clear product value.

## 6. OpenCode Compact Event Shape

Provider-local shape:

```ts
type OpenCodeCompactEvent = {
  event_type: string;
  observed_at?: string;
  cwd: string;
  pid?: number;
  opencode_session_id?: string;
  status_type?: string;
  permission_reply?: string;
  question_reply?: string;
  property_keys?: string[];
  wosm_project_id?: string;
  wosm_worktree_id?: string;
  wosm_worktree_path?: string;
  wosm_session_id?: string;
  wosm_terminal_provider?: string;
  wosm_terminal_target_id?: string;
};
```

This should be a strict Zod schema in `integrations/harness/opencode/src/eventSchema.ts`.

The runtime plugin should compact OpenCode's raw `event.properties` into this shape before sending. It must not forward full raw payloads by default. Large objects such as diffs, message parts, tool arguments, diagnostics arrays, or shell env should be summarized with keys/counts and omitted-field diagnostics.

Provider data on the resulting report can include small safe scalars:

```ts
{
  opencodeSessionId?: string;
  eventType: string;
  statusType?: string;
  permissionReply?: string;
  questionReply?: string;
  propertyKeys?: string[];
}
```

## 7. Status Mapping

Map OpenCode events to WOSM `ObservedStatus` as follows:

```text
permission.asked
  value: needs_attention
  confidence: high
  reason: OpenCode requested permission.

question.asked
  value: needs_attention
  confidence: high
  reason: OpenCode asked a question.

permission.replied reply=reject
  value: idle
  confidence: medium
  reason: OpenCode permission was rejected.

permission.replied reply=once|always
  value: working
  confidence: medium
  reason: OpenCode permission was approved.

question.replied
  value: working
  confidence: medium
  reason: OpenCode question was answered.

question.rejected
  value: idle
  confidence: medium
  reason: OpenCode question was rejected.

session.status status=busy
  value: working
  confidence: high
  reason: OpenCode session is busy.

session.status status=retry
  value: working
  confidence: medium
  reason: OpenCode session is retrying.

session.status status=idle
  value: idle
  confidence: high
  reason: OpenCode session is idle.

session.idle
  value: idle
  confidence: high
  reason: OpenCode session is idle.

session.error
  value: needs_attention
  confidence: high
  reason: OpenCode session reported an error.
```

All other event types:

```text
status: absent
```

Status absence is important. It means "diagnostic event only", not "unknown agent state".

## 8. Event Coalescing

Do not assign `coalesceKey` to every event, because the goal is to ingest all event types.

Use coalescing only where latest-state semantics are correct:

```text
session.status:<native-session-or-terminal-target>
permission.asked:<native-session-or-terminal-target>
question.asked:<native-session-or-terminal-target>
```

Avoid coalescing diagnostic event types such as message, file, lsp, todo, command, shell, and tool events unless a later real trace proves they are too noisy.

## 9. Effect Usage

### 9.1 Do Not Use Effect Inside The OpenCode Plugin

The OpenCode plugin should be dependency-free JavaScript installed into the user's OpenCode config directory.

Use plain Node APIs:

```text
node:net
node:fs
node:path
node:os
setTimeout
Promise
```

Reasons:

- The plugin runs inside OpenCode's plugin loader, not WOSM's package graph.
- It must be small enough to inspect and safe to overwrite.
- It must not require package installation or `node_modules`.
- It must never throw into OpenCode.
- It should match Herdr's operational model.

### 9.2 Use Existing Runtime Boundary Helpers In WOSM Packages

Provider health, installer, doctor, and real-test helpers should use existing WOSM runtime boundary helpers when crossing IO boundaries:

```text
runExternalCommand
runRuntimeBoundary
runRuntimeBoundaryWithTimeout
safeErrorFromUnknown
```

### 9.3 Effect Is Appropriate Only In Observer Queue/Protocol Internals

The observer harness ingress queue already uses Effect for queueing, refs, fibers, drain, and interruption. OpenCode should reuse that path by reporting `HarnessEventReport`.

Do not add new Effect code just to "grab" OpenCode events. Event grabbing happens in OpenCode's plugin callback.

Effect may be appropriate only if a later implementation adds a shared observer-side event batching service or queue primitive. That is not needed for the first OpenCode slice.

## 10. File Changes

### 10.1 OpenCode Integration

Primary files to add:

```text
integrations/harness/opencode/src/errors.ts
integrations/harness/opencode/src/discovery.ts
integrations/harness/opencode/src/eventSchema.ts
integrations/harness/opencode/src/compaction.ts
integrations/harness/opencode/src/mapping.ts
integrations/harness/opencode/src/opencodePlugin.ts
integrations/harness/opencode/src/pluginInstall.ts
```

Primary files to update:

```text
integrations/harness/opencode/src/provider.ts
integrations/harness/opencode/src/launch.ts
integrations/harness/opencode/src/index.ts
integrations/harness/opencode/test/unit/provider.test.ts
integrations/harness/opencode/package.json
integrations/harness/opencode/tsconfig.json
```

Responsibilities:

```text
errors.ts
  typed HarnessProviderError helpers for unavailable binary, invalid event, install failure

discovery.ts
  tmux-bound OpenCode run discovery, same pattern as Codex/Pi

eventSchema.ts
  strict compact OpenCode event schema

compaction.ts
  raw OpenCode event -> compact event plus payload summary

mapping.ts
  compact event -> HarnessEventReport and HarnessEventObservation

opencodePlugin.ts
  generated plugin asset string and version marker

pluginInstall.ts
  plan/install/uninstall/doctor for ~/.config/opencode/plugins/wosm-agent-state.js

provider.ts
  health, doctorChecks, buildLaunch, discoverRuns, classifyRun, ingestEvent

launch.ts
  real OpenCode args and WOSM observer env
```

### 10.2 CLI Wiring

Add:

```text
apps/cli/src/commands/opencodeHooks.ts
```

Update:

```text
apps/cli/src/main.ts
apps/cli/src/internal.ts
apps/cli/package.json
apps/cli/tsconfig.json
```

Command shape:

```bash
wosm hooks plan opencode
wosm hooks install opencode --yes
wosm hooks uninstall opencode --yes
wosm hooks doctor opencode
```

The command should use config-derived observer paths:

```text
observerSocketPath
stateDir
hookSpoolDir
autoStartFromHooks
wosmConfigPath
```

The OpenCode plugin install should respect:

```text
OPENCODE_CONFIG_DIR
```

when explicitly set, otherwise default to:

```text
~/.config/opencode
```

Do not edit `opencode.jsonc` for local plugin loading. OpenCode automatically loads files under `plugins/`.

### 10.3 Provider Factory And Config

Update:

```text
apps/observer/src/providers/factory.ts
packages/config/src/schema.ts
packages/config/test/fixtures/valid-config.json
apps/observer/test/unit/provider-factory.test.ts
```

`[harness.opencode]` already fits the generic harness provider config:

```toml
[harness.opencode]
enabled = true
command = "opencode"
install_hooks = true
```

Factory should pass observer paths into the OpenCode provider when `installHooks` or plugin diagnostics are enabled, just as Codex/Pi do.

### 10.4 Contracts

Only if adopting `nativeSessionId`:

```text
packages/contracts/src/hooks.ts
packages/contracts/src/observations.ts
packages/contracts/test/schema/contracts-schema.test.ts
packages/contracts/test/schema/diagnostics-schema.test.ts
tests/contract-fixtures/*
```

No OpenCode-specific contract schemas should be added to `packages/contracts`.

### 10.5 Observer And Persistence

Expected minimal changes:

```text
apps/observer/src/reconcile/run.ts
apps/observer/src/reconcile/harnessEventStatus.ts
apps/observer/src/persistence/*
apps/observer/test/integration/reconcile-opencode-harness.test.ts
apps/observer/test/unit/harnessEventStatus.test.ts
```

If `nativeSessionId` is added, carry it through provider observation persistence and debug bundle serialization. If it is deferred, observer changes should be limited to OpenCode tests and fixture expectations.

### 10.6 Provider Hooks Package

Primary OpenCode path should not require `packages/provider-hooks`.

Optional fallback:

```text
packages/provider-hooks/src/command.ts
packages/provider-hooks/src/sender.ts
packages/provider-hooks/src/index.ts
```

Add `wosm-ingress opencode <event>` only if needed for manual diagnostics or compatibility. It should not be the normal plugin path.

### 10.7 Docs

Update:

```text
docs/README.md
docs/manual-smoke.md
docs/system-dependencies.md
docs/install.md
tests/README.md
```

Add OpenCode real-lane instructions and manual verification.

## 11. Launch Plan Details

Current skeleton launches `opencode` with no args. The real provider should support:

### Interactive Mode

```text
command: opencode
cwd: worktree.path
args:
  --prompt <initialPrompt>       when initialPrompt is present
  --agent <profile-or-agent>     only if WOSM profile maps to OpenCode agent
  --dangerously-skip-permissions when permissionMode is yolo
```

Do not invent OpenCode sandbox/approval flags that do not exist. If WOSM config provides `approvalPolicy` or `sandboxMode`, record unsupported native mapping in provider diagnostics/providerData unless OpenCode adds compatible flags.

### Exec Mode

```text
command: opencode
cwd: worktree.path
args:
  run
  --format
  json
  --agent <profile-or-agent>     when configured
  --dangerously-skip-permissions when permissionMode is yolo
  <initialPrompt>                when present
```

Use `opencode run --help` as the source of truth for supported flags.

### Launch Env

Add these to launch env:

```text
WOSM_PROJECT_ID
WOSM_WORKTREE_ID
WOSM_WORKTREE_PATH
WOSM_HARNESS_PROVIDER=opencode
WOSM_SESSION_ID
WOSM_TERMINAL_PROVIDER
WOSM_TERMINAL_TARGET_ID
WOSM_OBSERVER_SOCKET_PATH
WOSM_OBSERVER_STATE_DIR
WOSM_HOOK_SPOOL_DIR
WOSM_CONFIG_PATH
```

The plugin should activate only when both WOSM ownership and observer routing are present:

```text
WOSM_HARNESS_PROVIDER=opencode
WOSM_WORKTREE_ID
WOSM_SESSION_ID
WOSM_OBSERVER_SOCKET_PATH
```

## 12. Plugin Install Design

Generated file:

```text
~/.config/opencode/plugins/wosm-agent-state.js
```

Version marker:

```js
// WOSM_INTEGRATION_ID=opencode
// WOSM_INTEGRATION_VERSION=1
```

The plugin should export a named plugin:

```js
export const WosmAgentStatePlugin = async () => {
  return {
    dispose: async () => {},
    event: async ({ event }) => {},
  };
};
```

Runtime behavior:

```text
if not launched by WOSM: return {}
on event: build compact report and send
on dispose: send a diagnostics/status release event if useful
all send errors: swallowed after optional spool
```

Spooling decision:

```text
P1 preferred: write HarnessEventReportSpoolRecord when WOSM_HOOK_SPOOL_DIR is present.
P1 fallback: ignore delivery failures like Herdr.
```

If spooling is included, keep it minimal and generated:

```text
mkdir -p $WOSM_HOOK_SPOOL_DIR
write spool_<timestamp>_<random>.json with schemaVersion, spoolId, createdAt, report, attempts, lastError
```

The plugin must not import `@wosm/*` packages.

## 13. Health And Doctor

Provider `health()`:

```text
opencode --version succeeds -> healthy
command missing/fails       -> unavailable
```

Provider `doctorChecks()`:

```text
opencode.command
  ok/error with version or typed SafeError

opencode.plugin
  ok when generated plugin file exists and version is current
  warn when install_hooks=false
  warn when config dir exists but plugin missing/stale and install_hooks=true
  error when config dir cannot be read

opencode.config
  ok when opencode debug config succeeds
  warn/error when config cannot be resolved
```

Do not require a specific provider credential in deterministic checks. Real tests can assume the user configured auth when `WOSM_REAL_OPENCODE=1` is set.

## 14. Deterministic Test Plan

All deterministic tests must pass without real OpenCode.

### 14.1 OpenCode Unit Tests

Add or expand:

```text
integrations/harness/opencode/test/unit/provider.test.ts
integrations/harness/opencode/test/unit/launch.test.ts
integrations/harness/opencode/test/unit/events.test.ts
integrations/harness/opencode/test/unit/plugin-install.test.ts
```

Coverage:

```text
health uses opencode --version through injected runner
health failure maps to SafeError
launch env includes observer/socket/spool/correlation env
yolo maps to --dangerously-skip-permissions
interactive initialPrompt maps to --prompt
exec mode maps to opencode run --format json
terminal-bound discovery returns opencode harness run
all documented event types parse to HarnessEventReport
status-bearing events map to expected ObservedStatus
unknown future event type produces diagnostics-only report
large properties are compacted and omitted fields are reported
plugin install plan writes expected version marker and does not edit opencode.jsonc
doctor identifies missing, stale, and current plugin files
```

### 14.2 Observer Integration Tests

Add:

```text
apps/observer/test/integration/reconcile-opencode-harness.test.ts
```

Coverage:

```text
tmux-bound OpenCode target appears as provider-neutral harness run
OpenCode status report updates live row status
OpenCode permission event projects needs_attention
OpenCode diagnostics-only event persists without overriding row status
nativeSessionId is carried if contract change lands
```

### 14.3 CLI Tests

Add or update:

```text
apps/cli/test/integration/hook-commands.test.ts
apps/cli/test/integration/diagnostic-commands.test.ts
```

Coverage:

```text
wosm hooks plan opencode
wosm hooks install opencode --yes
wosm hooks uninstall opencode --yes
wosm hooks doctor opencode
doctor includes OpenCode provider plugin diagnostics behind provider boundary
```

### 14.4 Contract Tests

If `nativeSessionId` lands:

```text
pnpm test:contracts
```

Update fixtures and schema tests for optional `nativeSessionId`.

### 14.5 Deterministic Gates

Focused during development:

```bash
pnpm --filter @wosm/opencode typecheck
pnpm test:unit -- integrations/harness/opencode
pnpm test:integration -- reconcile-opencode-harness
pnpm test:contracts
```

Before completion:

```bash
pnpm test:all
```

## 15. Real OpenCode Test Plan

Real OpenCode tests are opt-in only.

### 15.1 Package Script

Add:

```json
"test:e2e:opencode:real": "vitest run --config config/vitest/vitest.opencode-real.config.ts"
```

Add config:

```text
config/vitest/vitest.opencode-real.config.ts
```

### 15.2 Test Location

Add:

```text
tests/agent/real/opencode/
  README.md
  opencode-event-capture.test.ts
  opencode-session-create.test.ts
```

### 15.3 Required Flags

Real tests run only when:

```bash
WOSM_REAL_OPENCODE=1
```

Optional binary overrides:

```bash
WOSM_OPENCODE_BIN="$(command -v opencode)"
WOSM_TMUX_BIN="$(command -v tmux)"
```

Recommended preflight:

```bash
opencode --version
opencode debug config
opencode providers list
tmux -V
```

### 15.4 Real Event Capture Test

Purpose:

```text
Prove the generated plugin is loaded by real OpenCode and can observe actual OpenCode events.
```

Shape:

1. Create temp root.
2. Create temp `OPENCODE_CONFIG_DIR`.
3. Install generated WOSM plugin there.
4. Add probe mode env such as `WOSM_OPENCODE_EVENT_LOG=/tmp/events.jsonl`.
5. Run a bounded real OpenCode command:

```bash
OPENCODE_CONFIG_DIR="$tmp/config" \
WOSM_HARNESS_PROVIDER=opencode \
WOSM_WORKTREE_ID=wt_real_opencode \
WOSM_SESSION_ID=ses_real_opencode \
WOSM_OBSERVER_SOCKET_PATH="$tmp/run/observer.sock" \
opencode run --format json "Reply with the exact text WOSM_OPENCODE_OK."
```

6. Assert the probe JSONL contains at least one `session.*` event and valid compact reports.

This test may not require a live observer if it is only validating real OpenCode plugin loading and event grabbing. It should be separated from the full observer test.

### 15.5 Real Observer Harness Test

Purpose:

```text
Prove WOSM can launch OpenCode in tmux and ingest plugin reports through observer.harnessEvent.report.
```

Shape:

1. Build packages.
2. Create isolated temp WOSM config with:

```toml
[harness.opencode]
enabled = true
command = "/path/to/opencode"
install_hooks = true
```

3. Use temp observer socket/state.
4. Use temp tmux server/session.
5. Install OpenCode plugin into temp `OPENCODE_CONFIG_DIR`.
6. Dispatch `session.create` or `session.startAgent` with harness `opencode`.
7. Wait for command success and terminal target.
8. Wait for `harness.eventReported` events for provider `opencode`.
9. Assert snapshot row reaches `working` and later `idle` if the bounded prompt completes.
10. Write debug bundle on failure.

### 15.6 Real E2E Lane

Do not add OpenCode to the main real E2E lane immediately.

After the focused real OpenCode lane is stable, add an optional focused real E2E script:

```json
"test:e2e:real:opencode": "node scripts/run-real-e2e.mjs tests/e2e/real/real-opencode-hooks.test.ts"
```

Then consider broadening `pnpm test:e2e:real:local` only after repeated local success.

## 16. Manual Verification

After implementation:

```bash
pnpm build
pnpm setup:system:check
opencode --version
opencode debug config
opencode providers list
pnpm wosm hooks install opencode --yes
pnpm wosm doctor
```

Then launch through WOSM:

```bash
pnpm wosm tui
```

Manual UX implication:

```text
An OpenCode-launched row should no longer remain low-confidence unknown.
It should show working while OpenCode is generating, needs_attention when OpenCode asks for permission or a question, and idle when the session is idle.
```

Manual check:

```bash
pnpm wosm snapshot --json --include-debug
```

Inspect:

```text
providerHealth.opencode
rows[].agent.harness == "opencode"
rows[].agent.status.value
events containing harness.eventReported provider=opencode
diagnostic bundle commands/errors on failure
```

## 17. Implementation Steps

### Step 0: Real Event Reconnaissance

Do this before schema work:

```text
write temporary probe plugin under OPENCODE_CONFIG_DIR/plugins
run real opencode with the user's installed/authenticated binary
capture JSONL event envelopes for documented events reachable in a bounded run
record exact observed shapes in test fixtures
```

Output:

```text
tests/fixtures/opencode/events/*.json
```

or provider-local fixtures under:

```text
integrations/harness/opencode/test/fixtures/
```

### Step 1: Provider-Local Mapping

Build compact schema, compaction, status mapping, report construction, discovery, and launch env. No CLI installer yet.

Exit criteria:

```text
OpenCode unit tests pass
observer integration test passes with fake OpenCode reports
no observer core imports @wosm/opencode beyond provider factory/registry
```

### Step 2: Plugin Install And Doctor

Add generated plugin, install/plan/uninstall/doctor, CLI wiring, provider doctor checks.

Exit criteria:

```text
wosm hooks plan/install/doctor/uninstall opencode works against temp OPENCODE_CONFIG_DIR
doctor reports plugin status through provider checks
plugin does not edit opencode.jsonc
```

### Step 3: Real OpenCode Lane

Add focused opt-in real lane.

Exit criteria:

```text
WOSM_REAL_OPENCODE=1 pnpm test:e2e:opencode:real
```

passes locally with installed/authenticated OpenCode and tmux.

### Step 4: Docs And Real E2E

Update operational docs and optionally add focused real E2E coverage.

Exit criteria:

```text
docs explain setup, install, doctor, real lane, manual verification
test layout documents real OpenCode lane as opt-in
```

## 18. Acceptance Criteria

Functional:

```text
OpenCode provider health proves binary availability.
WOSM can launch real OpenCode from observer commands.
Generated OpenCode plugin is loaded by real OpenCode.
Every documented OpenCode event type can become a valid HarnessEventReport.
Unknown event types are accepted as diagnostics-only reports.
Status-bearing events update row state through existing observer projection.
Terminal/process evidence remains the authority for run identity and liveness.
```

Boundary:

```text
Observer core does not parse OpenCode providerData.
TUI does not import @wosm/opencode.
Shared contracts gain only provider-neutral fields, if any.
OpenCode plugin has no @wosm package dependency.
```

Performance:

```text
Plugin event callback returns quickly.
Socket delivery uses a short timeout.
No subprocess is spawned per event in the primary path.
Observer ACK remains enqueue-first through existing harness ingress queue.
```

Testing:

```text
pnpm test:all remains deterministic and does not require OpenCode.
Focused OpenCode unit/integration tests cover mapping and observer projection.
Real OpenCode lane is opt-in and documented.
Failed real tests produce enough observer/debug evidence to triage.
```

## 19. Risks And Open Questions

### OpenCode Event Shape Drift

OpenCode event property shapes may change. Mitigation:

```text
strict compact schema for WOSM-owned payload
generic event_type string for future events
property key summary for unknown shapes
real event capture fixtures refreshed when OpenCode changes
```

### Plugin Loader Behavior

OpenCode loads global plugins automatically, but local config can be customized. Mitigation:

```text
respect OPENCODE_CONFIG_DIR
doctor reports exact plugin path
real test validates plugin loading
```

### Auth And Model Access

`opencode --version` can pass while model execution fails. Mitigation:

```text
provider health proves launch availability only
real lane checks authenticated execution
doctor can include provider credential hints without blocking deterministic tests
```

### Spooling Complexity

Spooling from a dependency-free plugin duplicates a small part of WOSM's spool schema. Mitigation:

```text
keep spooling generated and tested
omit spooling in Step 1 if it delays real event capture
events are semantic hints, not liveness authority
```

### Event Volume

OpenCode can emit file, LSP, message, shell, and tool events. Mitigation:

```text
compact aggressively
only coalesce latest-state events
use observer queue metrics to decide if more coalescing is needed
do not store raw large payloads
```
