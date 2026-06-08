# Observer Hook Reconcile Profiling

Status: active profiling note from local use on `notify-hooks`.

## Scope

This is adjacent to, but broader than, the observer event notification PR.

The notification PR adds event hooks and exposes a real idle notification path. The performance issue observed during real E2E appears to be observer responsiveness under high hook volume, not notification delivery itself. Keep notify review separate unless notification-specific evidence later shows the event hook command path is the bottleneck.

This note is intended to be separable and safe to carry to `main` as runtime evidence and next-step guidance.

## Observed Symptoms

During local use on 2026-06-02:

- `pnpm wosm observer status` returned `status: "stopped"` only because the protocol request timed out.
- A live observer process still existed: PID `90885`.
- A live TUI process still existed: PID `93836`.
- TUI and CLI calls were timing out while provider hooks were active.
- Provider hook delivery had previously spooled due protocol delivery timeout.
- Current hook spool depth was empty, which means the spool had drained at the moment inspected, not that timeout pressure had not happened.

Process snapshot:

```text
PID 90885 observer, elapsed ~41m, CPU ~2.4%, RSS ~513MB
PID 93836 TUI, elapsed ~1h15m, CPU ~2.1%, RSS ~200MB
```

Protocol status result:

```json
{
  "status": "stopped",
  "error": {
    "tag": "TimeoutError",
    "code": "PROTOCOL_REQUEST_TIMEOUT",
    "message": "Observer protocol request timed out."
  }
}
```

## Runtime Evidence

Evidence was collected from the default state directory:

```text
~/.local/state/wosm/logs/observer.jsonl
~/.local/state/wosm/logs/hooks.jsonl
~/.local/state/wosm/spool/hooks/
```

Recent observer log sample:

```text
recent entries: 1500
Reconcile started: 689
Reconcile finished: 684
Command accepted: 24
Command started: 24
Command succeeded: 24
Event hook completed: 10
Event hook failed: 4
```

Recent wider reconcile sample:

```text
starts: 1384
finishes: 1378
```

Slowest reconciles in the sampled window:

```text
scheduled:batch(16)                 35925ms
hook:opencode:message.part.updated  30386ms
hook:batch(158)                     29626ms
scheduled:batch(17)                 25622ms
scheduled:batch(24)                 25088ms
scheduled:batch(22)                 24483ms
hook:opencode:message.part.updated  23229ms
hook:batch(58)                      23046ms
```

Recent reconcile reason aggregates:

```text
hook:batch(n)                         count 334  avg 2606ms  max 29626ms
scheduled:batch(n)                    count 295  avg 2867ms  max 35925ms
harness-report:codex:PreToolUse       count 224  avg 1614ms  max 7286ms
harness-report:codex:PostToolUse      count 194  avg 1313ms  max 4902ms
hook:opencode:message.part.updated    count 130  avg 2278ms  max 30386ms
hook:opencode:message.part.delta      count 84   avg 1492ms  max 4168ms
metadata:change_summary               count 25   avg 1713ms  max 4487ms
observer.startup                      count 12   avg 3216ms  max 10510ms
```

Recent tail after the worst period still showed repeated reconciles roughly every few seconds:

```text
hook:batch(69)                      1265ms
hook:batch(6)                       1663ms
hook:batch(13)                      1478ms
hook:batch(107)                     1465ms
hook:opencode:message.part.delta    1543ms
hook:opencode:message.part.delta    1795ms
hook:opencode:message.part.delta    1525ms
hook:opencode:message.part.delta    1604ms
hook:opencode:message.part.delta    1725ms
hook:batch(181)                     1454ms
```

Hook log tail:

```text
Provider hook delivered to observer: 952
Provider hook spooled for later delivery: 48
```

Representative spool errors:

```text
HOOK_REPORT_DELIVERY_TIMEOUT
Provider hook spooled for later delivery.
event: PreToolUse / PostToolUse
provider: codex
```

## Profiling Run: 2026-06-02 OpenCode Turn

The profiling branch was run against the active `notify-hooks` OpenCode session using a temporary local config that removed the notify event-hook stanza. This avoided mixing notify PR config support into the main-based profiling branch while preserving the same observer state directory, socket path, providers, and OpenCode/Codex harness setup.

Startup health showed real queued hook pressure:

```text
observer pid: 48611
hookSpoolDepth at startup: 87
active OpenCode row: wt_wosm_notify-hooks_1a08bb5233
active OpenCode state: working
active OpenCode pid: 10923
```

After startup and drain:

```text
hookSpoolDepth: 0
harnessIngressQueue.depth: 0
observer status: healthy
observer RSS after second window: ~663MB
observer CPU after second window: ~9%
```

First profiling window, 2026-06-02T04:38:57Z to 04:39:38Z:

```text
window entries: 44
Reconcile started: 11
Reconcile finished: 11
Reconcile profile: 11
Reconcile scheduler profile: 10
```

Scheduler backlog examples:

```text
hook:batch(4)                         queued=4   queuedWhileRunning=15  duration=7073ms
scheduled:batch(15)                   queued=15  queuedWhileRunning=8   wait=7144ms duration=3338ms
hook:opencode:message.part.delta      queued=24  queuedWhileRunning=52  duration=3523ms
hook:opencode:message.part.delta      queued=66  queuedWhileRunning=88  wait=3619ms duration=3997ms
hook:batch(88)                        queued=88  queuedWhileRunning=3   wait=4093ms duration=3580ms
hook:opencode:message.part.updated    queued=3   queuedWhileRunning=0   duration=3270ms
hook:opencode:message.part.delta      queued=59  queuedWhileRunning=83  wait=2547ms duration=3678ms
hook:batch(83)                        queued=83  queuedWhileRunning=0   wait=3773ms duration=3238ms
```

Phase profile examples from the same window:

```text
observer.startup                    total=3895ms drain=0ms   core=3893ms publish=0ms metadata=true
hook:batch(4)                       total=7071ms drain=682ms core=6387ms publish=0ms metadata=true
scheduled:batch(15)                 total=3296ms drain=0ms   core=3295ms publish=0ms metadata=true
hook:opencode:message.part.delta    total=3484ms drain=8ms   core=3475ms publish=0ms metadata=true
hook:opencode:message.part.delta    total=3992ms drain=8ms   core=3983ms publish=0ms metadata=true
hook:batch(88)                      total=3578ms drain=1ms   core=3576ms publish=0ms metadata=true
hook:opencode:message.part.updated  total=3268ms drain=1ms   core=3266ms publish=0ms metadata=true
hook:opencode:message.part.delta    total=3676ms drain=365ms core=3309ms publish=0ms metadata=true
hook:batch(83)                      total=3236ms drain=11ms  core=3224ms publish=0ms metadata=true
```

Second profiling window after spool drain, 2026-06-02T04:39:38Z to 04:40:21Z:

```text
Reconcile finished: 8
Reconcile profile: 8
Reconcile scheduler profile: 8
```

The second window stayed under OpenCode hook pressure even with `hookSpoolDepth = 0`:

```text
hook:opencode:message.part.updated  queued=10  queuedWhileRunning=19  total=3979ms core=3978ms
hook:batch(19)                      queued=19  queuedWhileRunning=8   total=3450ms core=3449ms
hook:batch(25)                      queued=25  queuedWhileRunning=45  total=3542ms core=3536ms
hook:batch(46)                      queued=46  queuedWhileRunning=0   total=3575ms core=3574ms
hook:batch(7)                       queued=7   queuedWhileRunning=4   total=3711ms core=3710ms
hook:batch(14)                      queued=14  queuedWhileRunning=30  total=3463ms core=3461ms
hook:opencode:message.part.delta    queued=30  queuedWhileRunning=0   total=3324ms core=3323ms
```

Process sampling during this run showed V8 JSON parsing, allocation, and GC activity while hook/reconcile traffic was active. The sample was mostly optimized JS frames, but it materially supports the log evidence that the runtime is allocation-heavy under hook pressure.

Run conclusion:

- Spool drain is not the steady-state hot spot. Startup had spool pressure, but the second window stayed hot after `hookSpoolDepth` reached zero.
- Event publication is not the hot spot. `publishMs` was effectively `0ms` in every profile.
- Full core reconcile is the hot spot. `coreReconcileMs` accounts for nearly all observed `totalMs` after startup.
- OpenCode turn streaming can keep the scheduler saturated. `message.part.delta` and `message.part.updated` repeatedly queued new reconciles while previous reconciles were still running.
- Metadata refresh is scheduled after every successful reconcile in this run. The phase profile does not time that async work directly, but repeated scheduling likely compounds external command load and should be profiled or throttled separately.

Follow-up mitigation added on this branch:

- The reconcile scheduler now keeps the existing short debounce for the first queued burst, but uses a longer backlog quiet period for follow-up work that accumulated while a reconcile was already running.
- Default initial debounce remains `100ms`; default backlog debounce is now `1000ms`.
- This does not skip the eventual follow-up reconcile. It reduces the steady-state cadence of expensive full reconciles during streaming hook storms, while status projection can still update rows from accepted harness reports before the next full reconcile.
- Focused unit coverage pins both immediate initial coalescing and delayed backlog follow-up behavior.

Post-mitigation live verification, same observer state/config shape, rebuilt observer pid `95885`:

```text
startup hookSpoolDepth: 41
hookSpoolDepth after window: 0
harnessIngressQueue.depth after window: 0
observer status: healthy
```

Profiles since 2026-06-02T04:43:56Z:

```text
observer.startup        total=2423ms drain=0ms   core=2421ms publish=0ms metadata=true
hook:batch(4)           total=4148ms drain=300ms core=3847ms publish=0ms metadata=true queuedWhileRunning=41
scheduled:batch(52)     total=2473ms drain=0ms   core=2472ms publish=0ms metadata=true wait=5121ms
metadata:pull_request   total=2322ms drain=1ms   core=2320ms publish=0ms metadata=true queuedWhileRunning=2
metadata:checks         total=2211ms drain=1ms   core=2209ms publish=0ms metadata=true wait=2750ms
hook:batch(7)           total=2963ms drain=0ms   core=2962ms publish=0ms metadata=true queuedWhileRunning=5
hook:batch(5)           total=1745ms drain=1ms   core=1743ms publish=0ms metadata=true wait=3899ms
```

The `scheduled:batch(52)` profile confirms the backlog quiet period is active: it waited for the running `hook:batch(4)` reconcile plus the additional backlog debounce before starting. The run also exposed metadata refresh as a follow-up pressure source (`metadata:pull_request`, `metadata:checks`), so the next likely mitigation is to throttle or coalesce metadata refresh reconcile requests independently.

Source filtering mitigation added after the scheduler mitigation:

- The generated OpenCode plugin now allowlists major lifecycle/status/tool/permission/question events before compaction or observer delivery.
- High-frequency streaming message events such as `message.part.delta` and `message.part.updated` are ignored at source, so they no longer open the observer socket, spool on delivery failure, persist hook events, project status, or request reconcile.
- The allowed events preserve turn-level TUI state transitions: session created/status/idle/deleted/error, permission/question attention states, tool start/end/failure/success, command execution, and interrupt command events.
- Unit coverage imports the generated plugin, sends a filtered `message.part.delta` event with a missing observer socket, and verifies no spool file is created. If the filter regresses, that event would attempt delivery and spool.

Important live-verification caveat:

- The installed OpenCode plugin was updated successfully, but already-running OpenCode sessions keep their previously loaded plugin. Those sessions must be restarted before source filtering affects real traffic.
- Log inspection after installing the filtered plugin still showed `hook:opencode:message.part.updated` and `hook:opencode:message.part.delta` reconcile reasons, which means the active OpenCode session was still using the old loaded plugin.
- Therefore the post-install live pressure below is not a source-filter result; it is old-plugin traffic with the scheduler backlog debounce in place.

Old-plugin post-install pressure sample, after the filtered plugin was installed but before restarting OpenCode:

```text
reconcile profiles: 21
scheduler profiles: 21
hook:opencode:message.part.updated count=4 avgTotal=3129ms avgCore=3127ms maxTotal=4217ms maxCore=4215ms
hook:opencode:message.part.delta   count=1 avgTotal=2664ms avgCore=2662ms maxTotal=2664ms maxCore=2662ms
hook:batch(4)                      total=21268ms core=21226ms queuedWhileRunning=201
scheduled:batch(203)               wait=22238ms total=6526ms core=4763ms
hook:batch(152)                    total=4800ms core=4799ms
hook:batch(97)                     total=3682ms core=3676ms
```

This sample confirms two things:

- The backlog debounce is working as a damage-control mechanism (`waitMs` grows and batches are coalesced), but it still lets old-plugin streaming events accumulate into large follow-up full reconciles.
- Source filtering should be strictly better for `message.part.*` storms once OpenCode is restarted, because filtered events never enter the observer path at all. A real restarted-session profile is still required to prove no required turn-level event was filtered out and to measure the remaining non-streaming event pressure.

## Current Dataflow

Provider hook delivery:

```text
Provider hook script
  -> provider hook sender / CLI ingress
  -> observer protocol socket
  -> observer reportHookEvent or reportHarnessEvent
  -> SQLite event and observation persistence
  -> provider-specific hook ingest or harness event projection
  -> event bus publish
  -> reconcileScheduler.request(reason)
  -> full observer reconcile after debounce
  -> observer.reconciled publish
  -> async metadata refresh scheduling
```

Notification event hook delivery:

```text
observer reconcile
  -> derive worktree.agentStateChanged when row agent state changes
  -> event bus publish
  -> event hook runtime matches configured filters
  -> run configured notification command
```

Important distinction:

- Provider hooks are ingress and can generate high event volume.
- Notification event hooks are egress and should only run on matched observer events.
- Current evidence points at ingress-triggered reconcile pressure, not notification command cost.

## Hot Spots

### Reconcile Frequency

`createReconcileScheduler` currently debounces for `100ms` by default. Under active Codex/OpenCode traffic, this can still produce near-continuous full reconciles because new hook batches arrive while the previous reconcile is running.

The scheduler coalesces bursts, but it does not apply a minimum quiet period after a completed reconcile. If more reasons arrived while reconciling, it schedules the next flush immediately after another debounce.

### Full Reconcile After Projected Hook State

Harness event reports already project status in observer runtime via `projectHarnessEventStatus(report)`, then still schedule a full reconcile when the report is accepted and not deduped.

That means high-volume reports such as `PreToolUse`, `PostToolUse`, OpenCode `message.part.delta`, and OpenCode `message.part.updated` can both update live projected state and then force repeated full graph refreshes.

### Metadata Refresh Coupling

Every successful reconcile schedules metadata refresh asynchronously when metadata refresh is configured. Even if this does not block the reconcile response directly, it adds external command load and can schedule additional work through git-ref invalidation or metadata updates.

Prior logs also show git and GitHub metadata timeouts in the observer log, which can compound local load.

### Protocol Starvation

The observer process was alive, but protocol requests timed out. That suggests the socket server was not getting timely responses while reconcile, persistence, external command, or GC work was active.

The macOS `sample` output was mostly optimized V8 frames, but it did show active JS allocation and GC with observer RSS around `513MB`. The log evidence is stronger than the stack sample for this pass.

## OpenCode Specificity

This is not purely OpenCode-specific.

Evidence for Codex pressure:

- `harness-report:codex:PreToolUse` had `224` reconciles in the sample.
- `harness-report:codex:PostToolUse` had `194` reconciles in the sample.
- Hook spool warnings in `hooks.jsonl` were Codex reports timing out on delivery.

Evidence for OpenCode pressure:

- `hook:opencode:message.part.updated` had `130` reconciles, average `2278ms`, max `30386ms`.
- `hook:opencode:message.part.delta` had `84` reconciles, average `1492ms`, max `4168ms`.

Likely conclusion:

- The generic problem is high-volume hook ingress causing full reconcile pressure.
- OpenCode may amplify it because message part events can be very frequent during generation.
- Codex also reproduces the problem through tool-use hooks and delivery timeout spooling.

## Relationship To Effect

Effect can improve lifecycle ownership for the event hook runtime and scheduler, but it is unlikely to fix this issue by itself.

The problem observed here is not primarily that the event hook runtime uses an async iterator loop. The problem is that observer work is being scheduled too frequently and some scheduled work is expensive enough to starve protocol responses.

Useful Effect work later:

- Make long-lived subscriptions/fibers easier to cancel and clean up.
- Add bounded queues and backpressure policies explicitly.
- Represent scheduler state and worker interruption more safely.

Not sufficient by itself:

- Replacing `for (;;)` with `Effect.forever` while still scheduling the same amount of full reconcile work.

## Profiling Added

This branch adds thresholded profiling logs around these phases:

```text
Reconcile scheduler profile
  reason
  queuedCount
  queuedWhileRunning
  waitMs
  durationMs
  queuedAfter

Reconcile phase profile
  reason
  totalMs
  drainMs
  coreReconcileMs
  publishMs
  metadataRefreshScheduled
  rows
  projectsScanned
```

The implementation uses thresholded logging to avoid making storms worse:

```text
log only if totalMs >= 1000
or queuedCount >= 25
or queuedWhileRunning > 0
```

This should answer whether time is spent in:

- hook spool drain
- harness ingress queue drain
- core provider reconcile
- event publication
- metadata refresh side effects
- scheduler backlog while a reconcile is running

Unit coverage verifies:

- Scheduler flush profiles include coalesced reason, queued count, duration, wait time, and queued-after counts.
- Scheduler profiles report requests that arrive while a reconcile is already running.
- Slow reconcile profiles emit phase dimensions through the real `createObserverApi` reconcile path.
- Fast reconcile profiles are suppressed.

## Possible Fix Directions

### 1. Increase Or Adaptive Debounce

Raise the default hook reconcile debounce from `100ms` to a larger value, or add adaptive backoff when work arrives during an active reconcile.

Tradeoff:

- Reduces storm pressure.
- Delays full snapshot convergence during active turns.
- Live projected harness state may still keep TUI useful without immediate full reconcile.

### 2. Do Not Full-Reconcile Every Projected Harness Report

For harness reports that successfully project live status, consider suppressing the full reconcile or scheduling it less frequently.

Candidate policy:

```text
project status immediately
publish worktree.agentStateChanged/session.updated events immediately
only full reconcile on terminal lifecycle, session start/stop, idle transition, or periodic interval
```

Tradeoff:

- Lower load during active token/tool streams.
- Must ensure eventual convergence still happens after important state changes.

### 3. Event-Type Priority And Coalescing

Coalesce high-volume event types more aggressively:

```text
OpenCode message.part.delta -> low-priority projection only
OpenCode message.part.updated -> coalesced periodic reconcile
Codex PreToolUse/PostToolUse -> projection plus delayed reconcile
Stop/idle/session status -> high-priority reconcile or direct event
```

### 4. Metadata Refresh Decoupling

Throttle or queue metadata refresh independently from reconcile frequency.

Candidate policy:

```text
at most one metadata refresh per worktree per interval
do not launch metadata refresh for every high-volume hook reconcile
skip metadata refresh when snapshot rows are unchanged
```

### 5. Protocol Health Fast Path

Ensure health/status requests can respond quickly even during reconcile pressure.

This may require avoiding blocking SQLite/external command work on the same critical path, or making command handling fairer under load.

## Recommended Next Step

Land a profiling-only change separately from notify, run one real OpenCode turn and one real Codex turn, then decide the first mitigation from measured phase data.

Suggested profiling acceptance criteria:

- Logs identify whether timeout windows correlate with scheduler backlog or slow core reconcile.
- Logs distinguish OpenCode message event pressure from Codex tool-use pressure.
- Logs show whether metadata refresh is compounding reconcile pressure.
- TUI/protocol timeout periods have adjacent observer profiles within the same minute.

If the profiling confirms the current evidence, first mitigation should be scheduler and reconcile policy, not notification hook changes.
