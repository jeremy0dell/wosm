# Hook/Event Naming Audit

Status: implemented cleanup map.

Use with `docs/naming.md`. This audit is intentionally broader than contract type names; the current naming blend appears in variable names, module names, protocol methods, event strings, config, generated scripts, tests, diagnostics, examples, and docs.

## Summary

WOSM has three separate concepts that currently share `hook` and `event` language:

- Provider hook ingress: provider-originated callbacks entering WOSM.
- WOSM observer events: observer-owned event bus/protocol events.
- Observer event hooks: configured commands that run after matching WOSM events.

The target vocabulary is:

```ts
ProviderHookEvent
ProviderHookReceipt
ProviderHookSpoolRecord

HarnessEventReport
HarnessEventReportReceipt
HarnessEventReportSpoolRecord

WosmEvent
WosmEventType

ObserverEventHookConfig
ObserverEventHookInvocation
```

`ProviderHookIngress` should name services/modules/processes, not the base payload schema.

## Implementation Result

Implemented on 2026-06-02:

- Preferred contract names are exported: `ProviderHookReceipt`, `ProviderHookPayloadSummary`, `ProviderHookScopeDecision`, `ProviderHookSpoolRecord`, `ObserverEventHookConfig`, and `ObserverEventHookInvocation`.
- Old exported contract names remain as compatibility aliases only.
- WOSM observer event strings are `providerHook.ingested` and `providerHook.spoolDrained`.
- The protocol primary method is `observer.ingestProviderHookEvent`; `observer.ingestHookEvent` remains as a legacy alias for installed scripts.
- Observer internals now use `ProviderHookIngress`, `providerHookIngress.ts`, and `observerEventHooks.ts`.
- Provider ingress spool helpers use `providerIngressSpool*` names while preserving the filesystem path `spool/hooks`, `hookSpoolDir`, and `hookSpoolDepth` compatibility surfaces.
- The visible notification setup command is `wosm event-hooks ...`; legacy `wosm hooks ... event ...` still aliases to it, and JSON output returns `category: "observer-event-hook"`.
- Normalized `HarnessEventReport` status evidence uses `source: "harness_event"`; `harness_hook` remains a legacy allowed source only.

## Audit Method

Initial inventory commands:

```bash
rg -n "\b(Hook|hook|Event|event|Ingress|ingress|Report|report)\b" apps packages integrations tests docs examples README.md -g '*.{ts,tsx,md,toml,json,mjs}'
rg -n "ProviderHook|HookReceipt|HookSpool|HookPayload|HookScope|EventHook|eventHooks|hook\.ingested|hook\.spoolDrained|harness\.eventReported|ingestHookEvent|reportHarnessEvent|hookIngestion|HookIngestion|harnessIngress|HarnessIngress|source: \"harness_hook\"|source: \"harness_event\"|hooks\.event|installHooks|autoStartFromHooks|hookSpool|HookSpool" apps packages integrations tests docs examples README.md -g '*.{ts,tsx,md,toml,json,mjs}'
```

Exclude historical docs from implementation mandates. Historical files are useful rationale but should not drive current naming.

## Findings

### 1. Contracts Mix Provider Hooks And Observer Event Hooks

Surface:

- `packages/contracts/src/hooks.ts`

Current names:

- `ProviderHookEvent`
- `HookReceipt`
- `HookPayloadSummary`
- `HookScopeDecision`
- `HookSpoolRecord`
- `EventHookConfig`
- `EventHookInvocation`

Problem:

The file defines both provider-ingress contracts and observer-event-hook contracts. The generic names make provider hook receipts/spool records look related to observer event hooks.

Recommended names:

- `HookReceipt` -> `ProviderHookReceipt`
- `HookPayloadSummary` -> `ProviderHookPayloadSummary`
- `HookScopeDecision` -> `ProviderHookScopeDecision`
- `HookSpoolRecord` -> `ProviderHookSpoolRecord`
- `EventHookConfig` -> `ObserverEventHookConfig`
- `EventHookInvocation` -> `ObserverEventHookInvocation`

Compatibility:

Keep aliases only for exported public contract names during a migration window.

### 2. WOSM Event Names Use Bare Hook

Surface:

- `packages/contracts/src/events.ts`
- `tests/contract-fixtures/events/events.json`
- `packages/protocol/test/fixtures/protocol-messages.json`
- observer/TUI/protocol event filter tests

Current names:

- `hook.ingested`
- `hook.spoolDrained`
- `HookIngestedEventSchema`
- `HookSpoolDrainedEventSchema`

Problem:

These are WOSM observer events about provider-hook ingress/spool drain. They are not observer event hooks. Since observer event hooks subscribe to `WosmEventType`, `hook.ingested` creates a confusing "event hook listens to hook event" shape.

Recommended names:

- `hook.ingested` -> `providerHook.ingested`
- `hook.spoolDrained` -> `providerHook.spoolDrained`
- `HookIngestedEventSchema` -> `ProviderHookIngestedEventSchema`
- `HookSpoolDrainedEventSchema` -> `ProviderHookSpoolDrainedEventSchema`

Compatibility:

This is a wire/event-string change. If current event subscriptions or diagnostics must read old bundles, compatibility should be handled in diagnostic readers or an event alias layer, not by keeping ambiguous names in new events.

### 3. Protocol Method Hides Provider Direction

Surface:

- `packages/protocol/src/api.ts`
- `packages/protocol/src/messages.ts`
- `packages/protocol/src/client.ts`
- `packages/protocol/src/server.ts`
- `apps/observer/src/runtime/api.ts`
- generated OpenCode plugin script in `integrations/harness/opencode/src/pluginInstall.ts`
- `packages/provider-hooks/src/sender.ts`

Current names:

- `ObserverApi.ingestHookEvent`
- `observer.ingestHookEvent`
- `HookIngestParamsSchema`

Problem:

The method accepts `ProviderHookEvent`. The current method name does not say provider and can be confused with observer event hook execution.

Recommended names:

- `ingestHookEvent` -> `ingestProviderHookEvent`
- `observer.ingestHookEvent` -> `observer.ingestProviderHookEvent`
- `HookIngestParamsSchema` -> `ProviderHookIngestParamsSchema`

Compatibility:

Keep `observer.ingestHookEvent` as an alias until generated Codex/OpenCode/Worktrunk/Pi hook scripts and any existing user installations are migrated.

### 4. Observer Runtime Module Names Blur Ingress And Egress

Surface:

- `apps/observer/src/hooks/ingestion.ts`
- `apps/observer/src/hooks/providerIngest.ts`
- `apps/observer/src/hooks/spool.ts`
- `apps/observer/src/hooks/harnessIngressQueue.ts`
- `apps/observer/src/hooks/eventHooks.ts`
- `apps/observer/src/runtime/api.ts`
- `apps/observer/src/runtime/main.ts`

Current names:

- `createHookIngestion`
- `HookIngestion`
- `HookIngestOptions`
- `ingestProviderHookEvent`
- `drainHookSpool`
- `createEventHookRuntime`

Problem:

Provider hook ingress, harness report queueing, spool drain, and observer event hook runtime all live under `src/hooks`. The local names distinguish some of this, but the directory and generic names still collapse ingress and egress.

Recommended names:

- `createHookIngestion` -> `createProviderHookIngress`
- `HookIngestion` -> `ProviderHookIngress`
- `HookIngestOptions` -> `ProviderIngressOptions` or `IngressOptions`
- `providerIngest.ts` -> `providerHookIngress.ts`
- `eventHooks.ts` -> `observerEventHooks.ts`
- Consider moving provider ingress modules under `apps/observer/src/ingress/` and event-hook egress under `apps/observer/src/events/` or `apps/observer/src/eventHooks/`.

Compatibility:

Internal rename only, except for test imports.

### 5. Spool Names Are Too Narrow For Current Contents

Surface:

- `packages/provider-hooks/src/spool.ts`
- `apps/observer/src/hooks/spool.ts`
- `packages/config/src/observerPaths.ts`
- observer health field `hookSpoolDepth`
- diagnostics and debug bundles
- filesystem path `spool/hooks`

Current names:

- `HookSpoolRecord`
- `HarnessEventReportSpoolRecord`
- `writeHookSpoolRecord`
- `writeHarnessEventReportSpoolRecord`
- `hookSpoolDir`
- `hookSpoolDepth`

Problem:

The spool now stores both raw provider hook envelopes and normalized harness event report records. `hookSpool` is acceptable as filesystem compatibility, but new names should not imply only raw hooks.

Recommended names:

- Schema/function names for raw hooks should become `ProviderHookSpoolRecord`.
- For shared spool operations, prefer `providerIngressSpool` or `providerEventSpool`.
- Preserve the filesystem path `spool/hooks` unless there is a separate migration reason.

### 6. CLI Treats Event Hooks As A Provider

Surface:

- `apps/cli/src/main.ts`
- `apps/cli/src/commands/eventHooks.ts`
- `apps/cli/test/integration/event-hooks-command.test.ts`

Current names:

- `provider === "event"`
- event-hook command output has `provider: "event"`
- command grammar: `wosm hooks install event notify-turn-completion --yes`

Problem:

This is the most visible naming leak. Notify/event hooks are not a provider.

Recommended options:

- Preferred: introduce `wosm event-hooks plan|install|doctor notify-turn-completion`.
- Acceptable: introduce `wosm hooks event plan|install|doctor notify-turn-completion`, where `event` is a category/subcommand, not a provider slot.
- Keep current `wosm hooks install event ...` as a compatibility alias if needed.
- Change result fields from `provider: "event"` to `category: "observer-event-hook"` or `kind: "observer-event-hook"`.

### 7. Config Shape Is Good But Docs Need Precision

Surface:

- `packages/config/src/schema.ts`
- `packages/config/src/load/normalize.ts`
- `examples/config.toml`
- `examples/dogfood-config.toml`
- `tests/support/real-wosm/config.ts`

Current names:

- `hooks.event`
- `[[hooks.event]]`

Assessment:

The TOML shape is acceptable because it reads as "hooks triggered by events". Do not churn user config without stronger reason.

Needed cleanup:

- Docs should call this `observer event hooks`.
- CLI and JSON output should avoid `provider: "event"`.
- Schema type names should become `ObserverEventHookConfig` and `ObserverEventHookInvocation`.

### 8. Status Sources Mix Transport And Normalized Evidence

Surface:

- `packages/contracts/src/observations.ts`
- Codex/Pi/OpenCode event mapping tests
- observer status projection tests
- TUI fake/dashboard fixtures

Current names:

- `harness_hook`
- `harness_event`

Problem:

Normalized `HarnessEventReport` status evidence often still uses `source: "harness_hook"`. That describes how the provider callback arrived, not the normalized evidence shape the observer consumed.

Recommended rule:

- Use `harness_event` for normalized harness event reports.
- Reserve `harness_hook` for legacy/raw provider hook status evidence that has not been normalized.

This should be audited carefully because it affects snapshot display strings, assertions, and diagnostic interpretation.

### 9. Provider-Hook Package Is Mostly Correct But Leans On Generic Receipt Names

Surface:

- `packages/provider-hooks/src/command.ts`
- `packages/provider-hooks/src/sender.ts`
- `packages/provider-hooks/src/deliveryPolicy.ts`
- `packages/provider-hooks/src/observerStartup.ts`
- `packages/provider-hooks/src/spool.ts`

Current names:

- Package name `@wosm/provider-hooks`
- `ProviderHookSenderOptions`
- `sendProviderHookEvent`
- `HookReceipt`
- `HookPayloadSummary`
- `hookReceiptFromReportReceipt`

Assessment:

The package identity is good: it owns generated provider hook delivery. The weak points are contract names and bridge helper names that convert harness report receipts into hook receipts.

Recommended cleanup:

- Use `ProviderHookReceipt` for raw provider hook delivery.
- Keep explicit conversion helpers while compatibility exists, but rename them to show compatibility mapping, for example `providerHookReceiptFromHarnessReportReceipt`.

### 10. Integration Names Should Preserve Provider-Native Hook Language At The Boundary

Surface:

- `integrations/harness/codex/src/hooks/*`
- `integrations/harness/codex/src/hookAdapter.ts`
- `integrations/harness/opencode/src/pluginInstall.ts`
- `integrations/harness/pi/src/piExtension.ts`
- `integrations/worktree/worktrunk/src/hooks.ts`
- `integrations/worktree/worktrunk/src/hookAdapter.ts`

Assessment:

Provider-native hook setup files can keep `hook` names because they directly edit provider hook systems. The cleanup should happen at the WOSM boundary:

- generated provider hook command -> provider hook ingress
- raw provider payload -> `ProviderHookEvent`
- normalized harness payload -> `HarnessEventReport`

Avoid renaming every provider-native `hook` symbol if it would obscure the external provider API.

### 11. Tests And Fixtures Encode The Old Language

Surface:

- `packages/contracts/test/schema/contracts-schema.test.ts`
- `tests/contract-fixtures/events/events.json`
- `tests/contract-fixtures/hooks/provider-hook-events.json`
- observer hook ingestion/spool tests
- protocol subscription fixtures/tests
- real dogfood hook tests
- TUI service fake observer tests

Problem:

Tests currently make the old names authoritative. They need to be renamed alongside code, not patched as an afterthought.

Recommended approach:

- Add red tests for the new names at the contract/protocol boundary first.
- Keep compatibility tests only where old wire names remain intentionally supported.
- Rename test descriptions from generic "hook event" to "provider hook event" or "observer event hook" as appropriate.

### 12. Docs Already Know The Boundary But Do Not Centralize It

Surface:

- `docs/architecture.md`
- `docs/diagnostics.md`
- `docs/harness-ingress.md`
- `docs/planning/completed/observer_hook_reconcile_profiling.md`
- `docs/planning/completed/provider_hook_scope_guard_plan.md`
- `README.md`

Current state:

The living architecture doc says hooks are notifications and fast status reports, not authoritative graph truth. The profiling note already distinguishes provider hooks as ingress and notification event hooks as egress.

Problem:

That boundary is scattered. Naming changes need one living naming source so future work does not reintroduce `hook event` ambiguity.

Recommended cleanup:

- Keep `docs/naming.md` as the source of truth.
- Link it from `docs/README.md`, `docs/architecture.md`, and relevant planning docs.
- Update operational docs after code renames land.

## Migration Plan

### Phase 0: Documentation And Audit - Done

Done when:

- `docs/naming.md` exists.
- This audit maps source, tests, docs, and user-facing surfaces.
- No runtime code is renamed yet.

### Phase 1: Internal Type And Module Names - Done

Rename internal/exported types with compatibility aliases:

- `HookReceipt` -> `ProviderHookReceipt`
- `HookPayloadSummary` -> `ProviderHookPayloadSummary`
- `HookScopeDecision` -> `ProviderHookScopeDecision`
- `HookSpoolRecord` -> `ProviderHookSpoolRecord`
- `EventHookConfig` -> `ObserverEventHookConfig`
- `EventHookInvocation` -> `ObserverEventHookInvocation`

Rename local variables/modules where there is no wire compatibility concern.

### Phase 2: Observer Event Names - Done

Rename WOSM event names:

- `hook.ingested` -> `providerHook.ingested`
- `hook.spoolDrained` -> `providerHook.spoolDrained`

Update event fixtures, event filters, protocol fixtures, TUI refresh behavior, observability evidence, and docs together.

### Phase 3: Protocol Compatibility Alias - Done

Add:

- `ObserverApi.ingestProviderHookEvent`
- `observer.ingestProviderHookEvent`

Keep:

- `ingestHookEvent`
- `observer.ingestHookEvent`

Generated OpenCode scripts and integration tests use the new method.

### Phase 4: CLI And Config UX - Done

Fix event-hook setup UX:

- Added `wosm event-hooks ...`.
- Kept `wosm hooks plan|install|doctor event ...` as a compatibility alias.
- Stopped returning `provider: "event"` for notification/event-hook setup.
- Keep `[[hooks.event]]` config shape.

### Phase 5: Status Source Cleanup - Done

Normalize status source naming:

- use `harness_event` for `HarnessEventReport`-derived status.
- keep `harness_hook` only for legacy raw provider hook evidence if still needed.

## Resolved Decisions

- Keep `observer.ingestHookEvent` as a legacy protocol alias for old installed hooks. New generated scripts call `observer.ingestProviderHookEvent`.
- Keep `hookSpoolDepth` in observer health as compatibility diagnostic language.
- Rename observer files in place under `apps/observer/src/hooks/` instead of moving directories in this slice.
- Use top-level `wosm event-hooks`; keep the old `wosm hooks ... event ...` route as a compatibility alias.

## Manual UX Verification

After implementation, manually verify:

- `wosm hooks doctor codex` and `wosm hooks doctor worktrunk` still read as provider hook setup.
- Notify setup reads as observer event hook setup, not a provider named `event`.
- `wosm snapshot` and TUI still refresh after provider hook ingestion and provider ingress spool drain.
- `wosm debug bundle` evidence separates provider hook delivery/spool from observer event hook command execution.
