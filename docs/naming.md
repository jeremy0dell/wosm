# Naming

Status: current living terminology for shared runtime, contract, protocol, and user-facing names.

Use this when changing names around providers, hooks, ingress, observer events, event hooks, status evidence, diagnostics, or CLI/config surfaces.

## Naming Rule

Names should answer three questions:

- Source: who produced this data or action?
- Direction: is it entering the observer, leaving the observer, or being configured by the user?
- Shape: is it a raw provider payload, a normalized report, an observer event, a receipt, or a durable/spooled record?

Avoid bare `hook` and bare `event` when the source or direction matters.

## Canonical Terms

### Provider Hook

A provider hook is an external provider callback or generated provider hook command. Examples include Worktrunk lifecycle hooks, Codex hooks, Cursor hooks, OpenCode plugin hooks, and Pi extension callbacks.

Use `provider hook` for provider-originated callback mechanics and generated hook setup.

### ProviderHookEvent

`ProviderHookEvent` is the raw shared envelope for provider-originated hook callbacks that enter WOSM.

It is still provider-ingress data, not a `WosmEvent`. Its `event` field means the provider/native event name.

Preferred related names:

```ts
ProviderHookEvent
ProviderHookReceipt
ProviderHookSpoolRecord
ProviderHookPayloadSummary
ProviderHookScopeDecision
```

`ProviderHookIngress` should name a service, module, queue, or process. It should not be the base schema name because ingress is the action/path, not the payload.

### HarnessEventReport

`HarnessEventReport` is a normalized report from a harness integration to the observer.

Use `Report` here because the harness is reporting evidence/status to the observer. It is not itself the public observer event. The observer may persist it, project status from it, publish `WosmEvent`s because of it, or schedule reconcile from it.

Preferred related names:

```ts
HarnessEventReport
HarnessEventReportReceipt
HarnessEventReportSpoolRecord
```

Do not rename this to `HarnessEventObservation` unless the persisted observation contract is renamed too; that name is already occupied by provider-observation payloads.

### WosmEvent

`WosmEvent` is the observer-owned event bus/public protocol event union.

These are events clients subscribe to and the TUI consumes. Examples include `worktree.agentStateChanged`, `command.failed`, and `observer.reconciled`.

Provider hook ingress may cause a `WosmEvent`, but it is not a `WosmEvent` until the observer emits one.

Preferred related names:

```ts
WosmEvent
WosmEventType
WosmEventFilter
```

### Observer Event Hook

An observer event hook is a user-configured command that runs when a `WosmEvent` matches.

The existing TOML shape is:

```toml
[[hooks.event]]
id = "notify-agent-idle"
events = ["worktree.agentStateChanged"]
command = "wosm"
args = ["notify", "turn-completion"]
```

The config shape can stay `hooks.event`, but code and docs should prefer `observer event hook` when precision matters.

Preferred related names:

```ts
ObserverEventHookConfig
ObserverEventHookInvocation
ObserverEventHookRuntime
```

`EventHook` is acceptable only in small local contexts where the observer/WOSM source is already obvious.

## Directional Model

Use this mental model for ambiguous changes:

```text
provider hook callback
  -> provider hook ingress
  -> ProviderHookEvent or HarnessEventReport
  -> observer persistence/projection/reconcile
  -> WosmEvent
  -> observer event hook command
```

Provider hooks are ingress. Observer event hooks are egress.

## Compatibility Names

Some names are compatibility aliases, not the preferred vocabulary:

- `HookReceipt`, `HookSpoolRecord`, `HookPayloadSummary`, and `HookScopeDecision` remain exported aliases for `ProviderHook*` names.
- `EventHookConfig` and `EventHookInvocation` remain exported aliases for `ObserverEventHook*` names.
- `observer.ingestHookEvent` remains a protocol alias for old installed provider hook scripts; generated scripts should call `observer.ingestProviderHookEvent`.
- `hook.ingested` and `hook.spoolDrained` are retired WOSM event strings. New events use `providerHook.ingested` and `providerHook.spoolDrained`.
- `hookSpool` names are acceptable for filesystem compatibility, but new code should prefer `providerHookSpool` or a broader `providerIngressSpool` when the spool contains both provider hook events and harness event reports.

When preserving compatibility, keep aliases local, documented, and temporary. Do not add alias-only wrappers for names that are not part of a public contract or generated script compatibility surface.

## Status Sources

Status source names should describe normalized evidence, not only the transport that carried it.

- Use `harness_event` for normalized harness event evidence.
- Reserve `harness_hook` for legacy/provider-native hook evidence when the fact has not been normalized into a harness event report.
- Use `harness_process` for live process/discovery truth.

Observer snapshots remain reconciled truth. Provider hooks and harness event reports are evidence or hints unless reconcile/status projection promotes them through observer-owned logic.

## User-Facing UX Rule

Provider hook setup and observer event hook setup should read as different features.

Avoid CLI/API output that treats event hooks as a provider. Prefer labels such as `observer-event-hook`, `event-hook`, or `category: "observer-event-hook"` over `provider: "event"`.

Manual verification after naming work:

- Provider setup output still clearly refers to Worktrunk/Codex/Cursor/OpenCode/Pi hooks.
- Notify setup output clearly refers to observer event hooks, not a provider named `event`.
- Event subscription output clearly uses WOSM event names.
- Debug evidence separates provider hook delivery/spool from observer event hook command execution.
