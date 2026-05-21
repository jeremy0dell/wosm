# Light Commenting Audit

**Status:** Planning addendum  
**Date:** 2026-05-21  
**Applies to:** current implementation after runtime, protocol, observer, diagnostics, Worktrunk, tmux, and scripted harness slices  
**Source baseline:** `docs/planning/wosm_rebuild_tdd_final_v1.md`, `docs/planning/wosm_phased_development_cycle_final_v1.md`, and `docs/planning/code_smell_remediation_p1_p2.md`

This document ranks the places where a small code comment would be most useful.

The goal is not to make the code chatty. Most code should remain self-documenting. Add comments only where the code expresses an invariant, fallback, concurrency behavior, provider quirk, or data-shape translation that is not obvious from names alone.

## 1. Commenting Rule

Good comments for this codebase should answer one of these questions:

```text
Why is this fallback or ordering intentional?
What invariant must future edits preserve?
What outside-system quirk is being normalized?
What concurrency/cancellation behavior is being protected?
What does this state machine or heuristic choose when inputs conflict?
```

Avoid comments that repeat the code:

```ts
// Increment the count.
counts.worktrees += 1;
```

Prefer comments like:

```ts
// Keep the rejected execution from breaking the per-scope chain; failures are persisted by executeCommand.
const settled = execution.catch(() => undefined);
```

## 2. Highest-Value Comment Targets

### 1. NDJSON Socket Backpressure And Iterator Bridge

File:

```text
packages/protocol/src/transport.ts
```

Best locations:

```text
ndjsonConnection state block around lines 189-200
data handler around lines 207-227
messages async generator around lines 245-260
```

Why this deserves a comment:

This function turns Node's push-style socket events into a pull-style `AsyncIterable`. The `messages`, `waiters`, `done`, and `streamError` state is not self-evident until the reader simulates socket data, parse failures, close events, and generator reads.

Suggested comment:

```ts
// Bridge push-style socket events into a pull-style AsyncIterable: parsed frames queue in
// messages, pending consumers wait in waiters, and close/error wake the generator so it can exit.
```

Optional second comment:

```ts
// A malformed frame poisons the stream and destroys the socket; the generator surfaces the parse error.
```

Comment value: very high.

### 2. Protocol Event Subscription Cleanup

File:

```text
packages/protocol/src/server.ts
```

Best locations:

```text
streamEvents around lines 207-228
nextEventOrClosed around lines 230-248
```

Why this deserves a comment:

The code races an event iterator against socket close and then calls `iterator.return` in `finally`. That is a subtle cleanup contract. Without a comment, future edits could easily leave server-side subscriptions alive after clients disconnect.

Suggested comment:

```ts
// Subscription streams must end when either the event iterator finishes or the socket closes;
// iterator.return lets the event bus release its per-client queue.
```

Comment value: very high.

### 3. Command Queue Per-Scope Serialization

File:

```text
apps/observer/src/commands/queue.ts
```

Best locations:

```text
scopeChains/pending/controllers declarations around lines 63-66
dispatch execution chain around lines 115-146
commandScope around lines 376-387
```

Why this deserves a comment:

`scopeChains` is the command queue's concurrency policy. Commands for the same session/worktree/project are serialized, while unrelated scopes can proceed independently. The `settled = execution.catch(...)` detail is especially non-obvious: it keeps one failed command from breaking later commands in the same scope.

Suggested comments:

```ts
// Commands serialize by the narrowest stable identity we can infer, so two operations on the
// same session/worktree/project cannot interleave while unrelated commands can still run.
```

```ts
// Store a non-throwing promise in the chain; executeCommand persists failures, and the next
// command in this scope should still be allowed to run.
```

Comment value: very high.

### 4. Command Timeout And Shutdown Cancellation Linking

File:

```text
apps/observer/src/commands/queue.ts
```

Best locations:

```text
executeCommand runtime boundary around lines 216-246
linkAbortSignals around lines 341-374
```

Why this deserves a comment:

Two cancellation sources are merged: runtime timeout and queue shutdown. The handler is checked before and after invocation because many provider operations are only cooperatively cancellable.

Suggested comments:

```ts
// Link the command timeout signal with queue shutdown so handlers see one cancellation channel.
```

```ts
// Check cancellation on both sides of the handler: some provider work only observes abort after it returns.
```

Comment value: very high.

### 5. Runtime Retry Attempt Semantics

File:

```text
packages/runtime/src/boundary.ts
```

Best locations:

```text
runRuntimeBoundaryWithRetryAndTimeout around lines 143-159
retryEffect around lines 233-250
```

Why this deserves a comment:

The retry implementation is compact Effect code. It is not obvious whether the timeout wraps one attempt or the whole retry sequence, or whether `retries` means attempts or retry count. Future boundary changes could alter behavior accidentally.

Suggested comments:

```ts
// The timed attempt is an Effect description, so each retry re-runs the task with its own timeout.
```

```ts
// attempt starts at 0; retries is the maximum number of retry attempts after the initial run.
```

Comment value: high.

### 6. External Command Abort Signal Merging

File:

```text
packages/runtime/src/externalCommand.ts
```

Best locations:

```text
task wrapper around lines 37-50
linkAbortSignals around lines 147-185
```

Why this deserves a comment:

This code merges a caller-provided signal with the runtime boundary's timeout signal before passing it to `execFile`. It also cleans up listeners. That behavior is important and easy to break while touching command execution.

Suggested comment:

```ts
// Merge caller cancellation with the runtime timeout signal so execFile aborts when either source fires.
```

Comment value: high.

### 7. Observer Graph Correlation Heuristics

File:

```text
apps/observer/src/reconcile/graph.ts
```

Best locations:

```text
statusPolicy around lines 57-120
chooseTerminal around lines 314-320
chooseHarnessRun around lines 323-335
compareObservations and compareHarnessRuns around lines 346-363
orphans around lines 464-515
```

Why this deserves a comment:

The graph builder encodes product policy, not just formatting. It picks a terminal by confidence and recency, prefers terminal-bound harness runs over worktree matches, sorts rows by urgency, and treats unmatched runtime state as orphaned. The names help, but they do not explain the tie-breakers or the fallback order.

Suggested comments:

```ts
// Lower priority values sort first; this is the user-facing urgency order for worktree rows.
```

```ts
// Prefer an explicit terminal-to-run binding when present, then fall back to the best run for the worktree.
```

```ts
// Runtime state without a configured worktree remains visible as an orphan instead of disappearing.
```

Comment value: high.

### 8. Worktrunk Hook TOML Shape Preservation

File:

```text
integrations/worktree/worktrunk/src/hooks.ts
```

Best locations:

```text
withGeneratedCommand around lines 256-270
withoutGeneratedCommand around lines 272-290
hookContainsCommand and commandInHookValue around lines 292-315
backupIfPresent around lines 369-390
```

Why this deserves a comment:

The hook installer preserves multiple possible TOML shapes: missing hook, string hook, array hook, table hook, and unrelated existing commands. The transformation rules are domain-specific and not obvious from the local branches.

Suggested comment:

```ts
// Worktrunk hook values may be strings, arrays, or tables. Preserve existing user hooks and
// add/remove only our generated command under the stable "wosm" key where possible.
```

Comment value: high.

### 9. Worktrunk List Output Normalization

File:

```text
integrations/worktree/worktrunk/src/parse.ts
```

Best locations:

```text
normalizePayload around lines 84-104
branchFromItem around lines 117-138
dirtyFromItem around lines 152-170
safeProviderData around lines 172-194
```

Why this deserves a comment:

The parser accepts several Worktrunk output shapes and aliases. It also derives a branch for detached worktrees, infers dirty state from multiple counters, and copies only safe provider data. These are provider compatibility rules, not obvious transform code.

Suggested comments:

```ts
// Accept the known Worktrunk shapes seen across versions: a raw array, a wrapper object, or a single item.
```

```ts
// Detached worktrees may not expose a branch name; use a short SHA when available, then path basename.
```

```ts
// Keep providerData small and schema-neutral: enough to debug Worktrunk output without storing the full payload.
```

Comment value: high.

### 10. Session Persistence Merge

File:

```text
apps/observer/src/persistence/correlations.ts
```

Best location:

```text
upsertSessions around lines 262-311
```

Why this deserves a comment:

Sessions are synthesized from both terminal observations and harness observations. Terminal data may arrive without harness data, and harness data may arrive later with better state. The merge preserves terminal provider information and takes the max `lastSeenAt`.

Suggested comment:

```ts
// Sessions are reconstructed from two partial truths: terminal bindings identify the workspace,
// while harness runs supply agent state. Merge both before upserting one durable session row.
```

Comment value: high.

## 3. Medium-Value Comment Targets

### 11. Hook Receiver Delivery Sequence

File:

```text
apps/cli/src/hookReceiver.ts
```

Best locations:

```text
receiveHookEvent around lines 58-88
lastStartByStateDir around line 36
maybeStartObserver around lines 134-176
```

Why this deserves a comment:

The hook receiver's behavior is policy-heavy: try online delivery, auto-start the observer if allowed, retry delivery, then spool. The rate limit is per state dir so hooks from the same installation do not start many observers at once.

Suggested comments:

```ts
// Delivery is best-effort and local-first: try the running observer, optionally start it once,
// then spool the event so hook execution does not block on observer availability.
```

```ts
// Rate-limit auto-starts per state dir so concurrent hooks from one installation do not fork storms.
```

Comment value: medium-high.

### 12. Config Normalization Recursion

File:

```text
packages/config/src/load/normalize.ts
```

Best location:

```text
normalizeObject around lines 208-227
```

Why this deserves a comment:

The generic normalizer maps snake_case to camelCase and then chooses child normalizers by normalized key. This is subtle and important because callers pass keys like `debugBundles`, not `debug_bundles`.

Suggested comment:

```ts
// Child normalizers are keyed by the normalized camelCase name, so callers can handle both
// explicit keyMap entries and automatic snake_case conversion consistently.
```

Comment value: medium-high.

### 13. Redaction Field-Versus-Value Policy

File:

```text
packages/observability/src/redaction.ts
```

Best locations:

```text
redactValue around lines 82-113
redactStringInternal around lines 115-133
```

Why this deserves a comment:

There are two redaction modes: redact entire fields when the key is sensitive, or redact matching substrings inside strings. That policy difference matters for logs and debug bundles.

Suggested comment:

```ts
// Key-based matches redact the whole field; value-pattern matches preserve surrounding text when safe.
```

Comment value: medium.

### 14. Observer Process Startup Health Wait

File:

```text
apps/cli/src/observerProcess.ts
```

Best locations:

```text
startObserver around lines 93-118
waitForObserverHealth around lines 156-188
defaultSpawnObserver around lines 194-208
```

Why this deserves a comment:

Startup spawns a detached child and then polls health through the socket using retry/timeout. That sequence is easy to mistake for "spawn succeeded means observer is ready."

Suggested comment:

```ts
// Spawn only starts the daemon process; the command returns running only after the socket health check succeeds.
```

Comment value: medium.

### 15. SQLite Migration Health Snapshot

File:

```text
apps/observer/src/sqlite.ts
```

Best locations:

```text
openObserverSqlite health closure around lines 62-72
applyMigrations around lines 117-161
```

Why this deserves a comment:

The handle caches applied migrations so health remains inspectable after close. Migrations update both an audit table and a simple meta key.

Suggested comments:

```ts
// Cache applied migrations so health() can still report the last known schema state after close().
```

```ts
// Record migrations both as an ordered audit trail and as a fast schema_version meta value.
```

Comment value: medium.

### 16. Event Bus Queue Shutdown

File:

```text
apps/observer/src/runtime/eventBus.ts
```

Best locations:

```text
effectQueueSubscription around lines 32-66
return method around lines 55-60
```

Why this deserves a comment:

Each subscriber owns an Effect queue, and `return` both removes it from the subscriber set and shuts down the queue so pending `take` calls unblock. That matters for protocol subscription cleanup.

Suggested comment:

```ts
// Each subscription owns a queue; return() removes it and shuts the queue down so pending takes unblock.
```

Comment value: medium.

### 17. Retention Max-Files Plus Max-Age Policy

File:

```text
packages/observability/src/retention.ts
```

Best location:

```text
enforceFileRetention around lines 120-145
```

Why this deserves a comment:

The retention policy deletes files that are either beyond the newest `maxFiles` or older than `maxDays`. The sort direction makes the index rule meaningful.

Suggested comment:

```ts
// Sort newest first, then delete anything beyond maxFiles or older than the age cutoff.
```

Comment value: medium.

### 18. Tmux Workbench Identity Binding

File:

```text
integrations/terminal/tmux/src/provider.ts
```

Best location:

```text
openWorkspace around lines 122-198
```

Why this deserves a comment:

The provider writes identity to tmux window and pane options so later discovery can correlate tmux panes back to wosm projects/worktrees/sessions. That is a cross-command invariant.

Suggested comment:

```ts
// Write identity into tmux options so future listTargets calls can correlate panes back to wosm state.
```

Comment value: medium.

### 19. Scripted Harness Identity Selection

File:

```text
integrations/harness/scripted/src/stateStore.ts
```

Best location:

```text
firstIdentity around lines 101-128
```

Why this deserves a comment:

The scripted provider uses the first seen identity field rather than the last. That is a policy choice worth documenting if it is intentional.

Suggested comment:

```ts
// Identity fields are sticky for a run: use the first non-empty value so later activity events cannot drift it.
```

Comment value: medium, but verify the policy before adding.

### 20. Launch Command Quoting Split

File:

```text
integrations/terminal/tmux/src/launch.ts
```

Best location:

```text
quoteCommand and quoteArg around lines 21-35
```

Why this deserves a comment:

Command names and arguments allow different safe characters. The code is small, but a comment could prevent someone from merging the two regexes casually.

Suggested comment:

```ts
// Commands and args have different safe character sets; keep command paths conservative and args shell-safe.
```

Comment value: medium-low.

## 4. Lower-Value Or Defer

These areas are complex but should usually be refactored before being commented, or are already covered by the P1/P2 smell remediation plan.

```text
apps/observer/src/diagnostics/collector.ts
apps/observer/src/hooks/breadcrumbs.ts
integrations/worktree/worktrunk/src/metadata.ts
apps/observer/src/persistence/rows.ts
packages/observability/src/errors.ts
apps/observer/src/runtime/api.ts
apps/observer/src/commands/session/shared.ts optional-object builders
```

Reason:

Many of these blocks are hard to read because they need boundary cleanup, schema extraction, or optional-field construction cleanup. Comments would help less than the P1/P2 remediation already planned.

If comments are added after those refactors, keep them focused on durable rules:

```text
why a field is optional versus absent
why a provider-specific fallback exists
why one schema owns a shared payload shape
why a diagnostic check intentionally degrades rather than errors
```

## 5. Suggested Execution Order

Add comments in this order:

```text
1. protocol transport async iterable bridge
2. protocol server subscription cleanup
3. command queue scope serialization
4. command queue cancellation linking
5. runtime retry/timeout semantics
6. external command abort-signal merging
7. observer graph correlation heuristics
8. Worktrunk hook TOML preservation
9. Worktrunk parser normalization rules
10. session persistence merge
11. hook receiver delivery sequence
12. config normalization recursion
13. redaction policy split
14. observer startup health wait
15. SQLite migration health snapshot
16. event bus subscription queue shutdown
17. retention max-files plus max-age policy
18. tmux identity binding
19. scripted harness identity selection
20. launch command quoting split
```

This sequence starts with the comments most likely to prevent subtle concurrency, subscription, and command-lifecycle regressions.

## 6. Acceptance Criteria

For a commenting pass based on this audit:

```text
comments are short and explain intent, invariants, or external quirks
no function gains a header comment unless the body is genuinely non-obvious
no comments merely restate variable names or branch conditions
comments are added near the code they protect
P1/P2 smell remediation is not blocked by comments that describe soon-to-be-removed code
pnpm lint passes
```
