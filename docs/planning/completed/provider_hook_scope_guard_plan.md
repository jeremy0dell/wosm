# Provider Hook Scope Guard Plan

**Status:** Completed planning record
**Date:** 2026-05-24  
**Severity:** P1 behavioral boundary issue  
**Applies to:** all wosm-installed provider hooks, CLI hook receiver, observer hook ingestion  
**Source baseline:** `docs/planning/historical/wosm_rebuild_tdd_final_v1.md`

This document records the fix for over-broad hook reporting from wosm-installed hooks.

The important rule is provider-neutral:

```text
If wosm installs a hook into a global or provider-wide hook system, that hook must prove it belongs to a wosm-owned or explicitly adopted runtime before it reports to observer.
```

Codex is the first concrete case, but the rule applies to every hook installed by wosm for every provider.

## 1. Current Problem

Some provider hook systems are global or broad by nature. Installing a hook into such a system can make the hook run for sessions that wosm did not launch and should not observe.

Current Codex example:

```text
wosm installs commands into the Codex hook config.
Codex executes those hook commands for Codex sessions using that config.
The generated hook command calls `wosm-ingress codex <event>`.
wosm then tries to correlate the hook after receiving it.
```

That is too late. Unrelated sessions can already:

```text
invoke the wosm CLI
write hook logs
auto-start observer
create hook spool records
create harness event reports
possibly correlate by cwd
```

This is not just a Codex issue. Any future wosm-installed provider hook with broad provider scope has the same risk.

## 2. Ownership Rule

There are two different events:

```text
provider fires a configured hook command
wosm accepts that hook as a wosm runtime event
```

wosm must not assume those are the same.

The hook must be ignored before observer delivery unless it passes a wosm scope check.

Ignored hooks:

```text
exit successfully
do not auto-start observer
do not spool
do not create observer events
do not create provider observations
do not create harness event reports
do not produce noisy diagnostics
```

## 3. Scope Policy

Use two provider-neutral acceptance modes.

### Mode A: Owned Runtime

Accept when hook context proves wosm ownership.

Required context:

```text
WOSM_SESSION_ID
WOSM_WORKTREE_ID
```

Recommended context:

```text
WOSM_PROJECT_ID
WOSM_WORKTREE_PATH
WOSM_PROVIDER
WOSM_PROVIDER_KIND
WOSM_TERMINAL_PROVIDER
WOSM_TERMINAL_TARGET_ID
```

Provider-specific hooks may also expose provider-native ids, but those are not enough by themselves. A provider session id, terminal id, or process id does not prove wosm ownership unless it is bound to wosm context.

Default mode:

```text
owned-only
```

Meaning:

```text
Only runtimes launched or explicitly prepared by wosm report hooks.
```

### Mode B: Adopted Worktree Runtime

Optionally accept when the hook context does not contain wosm ownership env, but the hook payload proves it is running inside a known configured worktree.

This supports manual workflows:

```text
developer opens a shell in a wosm-known worktree
developer starts a supported agent manually
provider hook fires
wosm accepts the hook because cwd belongs to a known worktree
```

This must be explicit configuration, not the default.

Possible config:

```toml
[hooks]
scope = "owned-only"
```

Allowed values:

```text
owned-only
owned-or-known-worktree
```

Provider-specific overrides can exist later:

```toml
[harness.codex]
hook_scope = "owned-or-known-worktree"
```

But global semantics should remain consistent across providers.

## 4. Hook Script Guard

Every wosm-generated provider hook script should include an early scope guard before invoking `wosm-ingress`.

For `owned-only`:

```sh
if [ -z "${WOSM_SESSION_ID:-}" ] || [ -z "${WOSM_WORKTREE_ID:-}" ]; then
  exit 0
fi
```

Then provider-specific hook command continues:

```sh
wosm-ingress <provider> "$event" < "$payload_file" > /dev/null
```

This is the cheapest guard because unrelated provider sessions never invoke the wosm CLI.

For `owned-or-known-worktree`, the generated script may invoke `wosm-ingress` without ownership env because the receiver needs config/worktree knowledge to evaluate `cwd`.

The script behavior must be:

```text
out-of-scope hook -> exit 0
in-scope hook -> invoke wosm-ingress
malformed in-scope payload -> existing invalid-payload behavior
wosm-ingress unavailable for out-of-scope session -> irrelevant because script exits before invoking wosm-ingress
```

## 5. CLI Receiver Guard

The CLI hook receiver must enforce the same scope policy as defense in depth.

This is required even if generated scripts include guards because:

```text
old hook scripts may still be installed
users may invoke wosm hook directly
provider hook capabilities may differ
future providers may not support cheap shell env guards
```

Add a provider-neutral scope decision before delivery, auto-start, or spooling.

Possible shape:

```ts
type ProviderHookScopeDecision =
  | { action: "accept"; reason: "wosm-env" | "known-worktree" }
  | { action: "ignore"; reason: "missing-wosm-env" | "outside-known-worktree" };
```

The guard should run after the hook payload is parsed enough to inspect common scope fields, but before:

```text
deliverHook
deliverHarnessEventReport
maybeStartObserver
spool
spoolHarnessEventReport
provider-specific hook ingestion
```

For `owned-only`:

```text
accept if WOSM_SESSION_ID and WOSM_WORKTREE_ID are present in env or normalized payload context
otherwise ignore
```

For `owned-or-known-worktree`:

```text
accept if WOSM_SESSION_ID and WOSM_WORKTREE_ID are present
else accept if normalized cwd is inside a known configured worktree
else ignore
```

Ignored hooks should return a quiet successful ignored receipt or internal result. They should not look like operational failures.

## 6. Provider Hook Context Normalization

Each hook integration should normalize provider payloads into shared scope fields before the scope decision.

Common normalized fields:

```text
provider
provider kind
event name
cwd
wosm project id
wosm worktree id
wosm worktree path
wosm session id
wosm terminal provider
wosm terminal target id
```

Provider-specific payload fields stay behind integration parsers.

Examples:

```text
Codex payload cwd -> normalized cwd
Codex env WOSM_SESSION_ID -> normalized wosm session id
future provider native workspace path -> normalized cwd or worktree path
future terminal hook target id -> normalized terminal target id
```

The receiver should not need to parse provider-specific payload shapes directly once normalization exists.

## 7. Worktree Scope Lookup

For adopted-worktree mode, the receiver needs a known-worktree check.

Preferred source order:

```text
1. already-running observer snapshot, if cheap and available
2. provider-neutral persisted recent worktree observations
3. explicit lightweight worktree-scope helper
```

Avoid:

```text
starting observer only to decide hook scope
accepting project root as a worktree
accepting arbitrary cwd under a configured project root
glob-scanning .worktrees without provider semantics when provider data is available
```

The path check should:

```text
normalize /private/var and /var aliases on macOS
resolve trailing slashes consistently
accept cwd equal to a worktree path
accept cwd inside a worktree path
reject cwd equal to a project root
reject cwd outside configured worktrees
```

## 8. Correlation Rules After Acceptance

Scope decides whether wosm should process the hook at all.

Correlation decides which wosm row/session should be updated.

After a hook is accepted:

```text
owned-runtime hooks may use explicit wosm_* fields
adopted-worktree hooks may correlate by cwd to a known worktree
unmatched accepted hooks remain diagnostic-only
```

Do not use cwd fallback for ignored hooks.

Do not allow a random provider session in the repository root to become a wosm agent.

## 9. Tests

### Shared Hook Scope Tests

Required cases:

```text
owned-only accepts hook with WOSM_SESSION_ID and WOSM_WORKTREE_ID
owned-only ignores hook without WOSM_SESSION_ID
owned-only ignores hook without WOSM_WORKTREE_ID
ignored hook does not call observer client
ignored hook does not call startObserver
ignored hook does not write hook spool
ignored hook does not call provider-specific report conversion
invalid JSON still returns existing invalid-payload behavior when wosm-ingress or the compatibility wrapper is invoked
```

### Generated Hook Script Tests

Every wosm-installed hook generator should have tests proving:

```text
owned-only script exits before wosm-ingress when WOSM_SESSION_ID is absent
owned-only script exits before wosm-ingress when WOSM_WORKTREE_ID is absent
owned-only script invokes wosm-ingress when both are present
script remains generated for all expected provider hook event names
```

Codex is the first concrete generator to cover.

### Adopted Worktree Tests

Only if adopted-worktree mode is implemented in the same slice:

```text
hook without WOSM_* context is accepted when cwd is inside a known worktree
hook without WOSM_* context is ignored when cwd is project root
hook without WOSM_* context is ignored when cwd is outside configured projects
known-worktree check does not auto-start observer
known-worktree check normalizes /private/var and /var aliases
```

### Provider Integration Tests

For each provider with wosm-installed hooks:

```text
provider hook payload normalizes scope fields
provider-specific hook is ignored out of scope
provider-specific hook is accepted in owned runtime
accepted owned hook still updates live agent/status behavior
unmatched accepted hook remains diagnostic-only
```

## 10. Acceptance Criteria

The fix is complete when:

```text
all wosm-installed provider hooks have a scope guard
ordinary non-wosm provider sessions do not invoke wosm-ingress in owned-only mode when script gating is possible
ordinary non-wosm provider sessions do not auto-start observer
ordinary non-wosm provider sessions do not create hook spool records
ordinary non-wosm provider sessions do not create harness event reports
wosm-launched agents still report hooks
wosm-launched hooks still include project/worktree/session correlation
manual provider sessions are ignored unless adopted-worktree mode is enabled
adopted-worktree mode never accepts project root as a worktree
doctor output can still report whether provider hooks are installed
```

## 11. Non-Goals

This plan does not require:

```text
changing provider global hook systems
building per-worktree provider config directories
removing hook installation support
changing Worktrunk lifecycle hook semantics unless they are wosm-installed broad hooks
changing terminal provider behavior
changing harness status classification beyond hook scope
```

## 12. Verification

Minimum verification:

```text
pnpm --filter @wosm/contracts test
pnpm --filter @wosm/cli test
pnpm --filter @wosm/observer test
pnpm --filter @wosm/codex test
pnpm test:all
manual: current non-wosm Codex chat does not show "Notify wosm" in owned-only mode
manual: wosm-launched agent still reports status changes
```
