# CLI TypeScript Braid Audit Findings

Status: remediated
Date: 2026-05-29
Scope: every non-test file under `apps/cli`
Boundary reference: `docs/planning/typescript_braid_audit_plan.md`, with current rules from `docs/architecture.md` and `docs/development.md`

Remediation summary, 2026-05-29:

- CLI-1 fixed by narrowing `@wosm/cli` and adding explicit `@wosm/cli/internal` support exports.
- CLI-2 fixed by validating command ids, doctor options, and debug-bundle filters at the CLI boundary.
- CLI-3 fixed by replacing ad hoc debug-trace attribute field probing with named schema-backed parsers.
- CLI-4 fixed by sharing positive-integer timeout parsing for observer, TUI, and command paths.
- CLI-5 fixed by rejecting missing or command-shaped global `--config` values before command routing.

## Findings

### CLI-1: `@wosm/cli` exports the whole implementation barrel

- Files: `apps/cli/package.json:6-11`, `apps/cli/src/index.ts:1-12`
- Boundary: P0.3 / public export inventory
- Evidence: package export `"."` points at `dist/index.js`, and `src/index.ts` re-exports every command module, `main`, observer process helpers, path helpers, and stdin helpers with `export *`.
- Why it matters: this makes command internals, test dependency bags, lifecycle helpers, provider-specific hook command adapters, and local utility functions part of the public `@wosm/cli` declaration surface. The current tests already import several internals through `@wosm/cli` (`runObserverCommand`, `runPopupCommand`, `runTuiCommand`, `ObserverProcessDeps`, `ChildProcessLike`, `observerRuntimeFreshnessCheck`), so narrowing the public API later will require either a supported test-support/internal export path or source-relative test imports.
- Suggested direction: inventory the exported symbols into public, test-support, package-internal, and accidental groups. Keep `runCli` and intentionally supported lifecycle APIs public; move command runners/dependency types behind a deliberate `./internal` or test-support surface if they need cross-package access.
- UX implication: no immediate CLI behavior change, but it reduces future accidental dependency on command internals.
- Manual verify: after a split, run `pnpm build` and inspect `apps/cli/dist/index.d.ts` plus any new internal declaration entrypoint.

### CLI-2: raw argv values are assigned into existing contract option/id shapes before schema parsing

- Files: `apps/cli/src/commands/debugBundle.ts:79-117`, `apps/cli/src/commands/doctor.ts:69-87`, `apps/cli/src/commands/command.ts:248-269`
- Boundary: P0.1 branded ids / guardrail to keep strict schemas at untrusted CLI boundaries
- Evidence: `parseDebugBundleOptions` returns `DiagnosticCollectionOptions` while assigning raw strings to `projectId`, `commandId`, `traceId`, and `since`; `parseDoctorOptions` returns `DoctorOptions` while assigning raw `projectId`; `parseGetArgs` assigns raw `args[0]` to `CommandId`.
- Why it matters: schemas already exist for these shapes (`DiagnosticCollectionOptionsSchema`, `DoctorOptionsSchema`, `CommandIdSchema`, `ProjectIdSchema`, `TraceIdSchema`). The protocol client validates params before writing to the socket, so malformed values are not sent over the wire, but the CLI has already constructed typed domain option values from raw argv by then. That weakens the branded-id migration path and gives less local control over CLI error messages.
- Suggested direction: parse at the CLI boundary with the existing contract schemas or small command-local parsers that call those schemas. Keep protocol validation as the transport boundary, not the first place raw argv values become validated.
- UX implication: invalid ids/timestamps should fail with command-specific validation errors before observer startup or RPC collection work.
- Manual verify: `wosm command get ""`, `wosm doctor --project ""`, and `wosm debug bundle --since not-a-date` should reject before contacting the observer.

### CLI-3: `debug trace` has a local record/string-field probing cluster for log attribute shapes

- File: `apps/cli/src/commands/debugTrace.ts:324-350`, `apps/cli/src/commands/debugTrace.ts:409-464`
- Boundary: code-smell remediation rule for `unknown`, schema-backed payloads, and local JS-style type helper clusters
- Evidence: `matchFromLog` reads `commandId`, `traceId`, `spanId`, `commandType`, and `error` from `LogRecord.attributes` through `recordAttributes`, `recordField`, and `stringField`; `errorFromAttributes` casts `unknown` to `Record<string, unknown>` and manually extracts `code`, `message`, `provider`, and `diagnosticId`.
- Why it matters: `LogRecord` itself is schema-validated, and `SafeErrorSchema`/`ErrorEnvelopeSchema` already define safe error shapes. The generic `attributes` field can stay generic, but this code is no longer doing generic traversal once it knows specific keys and error fields. It recreates a partial schema by hand and is exactly the helper-cluster pattern the remediation guidance calls out.
- Suggested direction: replace the field helpers with a named parser for the legacy/fallback log attribute shape, ideally using `SafeErrorSchema.safeParse` for `attributes.error` and a small strict schema for any supported legacy command fields. If the fallback is only for older logs, name it that way.
- UX implication: `wosm debug trace` should keep matching old logs, but malformed log attributes should be ignored through an explicit parser instead of ad hoc field reads.
- Manual verify: run `wosm debug trace --latest-failure` against a state dir with both current logs and older logs that only stored ids in attributes.

### CLI-4: `--timeout-ms` accepts `NaN`, zero, and negative values in observer and TUI commands

- Files: `apps/cli/src/commands/observer.ts:91-107`, `apps/cli/src/commands/tui.ts:162-178`
- Boundary: CLI input parsing / typed option construction
- Evidence: both `takeTimeoutOption` helpers return `timeoutMs: Number(value)` with no `Number.isSafeInteger` or positive-value check. `apps/cli/src/commands/command.ts:271-280` already has the stricter local pattern.
- Why it matters: `timeoutMs?: number` can contain `NaN`, `0`, or a negative value after parsing. Those values flow into observer startup, protocol client timeouts, or TUI startup reconciliation, where they can cause immediate timeouts or runtime-specific timer behavior rather than a clear CLI validation error.
- Suggested direction: share or duplicate the stricter `parseTimeoutMs` helper used by the command subcommand, and reject missing, non-integer, zero, and negative values before constructing runtime options.
- UX implication: bad timeout input should fail immediately with `--timeout-ms must be a positive integer.`
- Manual verify: `wosm observer status --timeout-ms nope` and `wosm tui --timeout-ms -1` should fail before starting/contacting the observer.

### CLI-5: global `--config` can be silently dropped or consume the command name

- File: `apps/cli/src/main.ts:313-332`
- Boundary: CLI input parsing / exact optional construction
- Evidence: `parseGlobalOptions` assigns `configPath = argv[index + 1]` and increments the index without checking that a value exists or that the next token is not another flag/command. If `--config` is last, the returned object simply omits `configPath`; if the user writes `wosm --config doctor`, `doctor` becomes the config path and the command is parsed from the remaining args.
- Why it matters: the global parser constructs an absent optional field from malformed input, so a user can accidentally run with the default config or a misparsed command instead of getting a boundary error.
- Suggested direction: validate `--config` like other valued CLI options: require a non-empty next value and reject a following token that is another global option. If command names are valid path names by design, at least reject the missing-value case explicitly.
- UX implication: malformed global config usage should stop before config loading, observer startup, popup, or TUI launch.
- Manual verify: `wosm --config` should fail with `--config requires a value.`

## Files With No Findings

- `apps/cli/src/paths.ts`
- `apps/cli/src/commands/codexHooks.ts`
- `apps/cli/src/commands/configDiagnostics.ts`
- `apps/cli/src/commands/popup.ts`
- `apps/cli/src/commands/reconcile.ts`
- `apps/cli/src/commands/snapshot.ts`
- `apps/cli/src/commands/worktrunkHooks.ts`
- `apps/cli/src/observerProcess.ts`
- `apps/cli/src/stdin.ts`
- `apps/cli/tsconfig.json`

## Audited Files With Findings

- `apps/cli/package.json`
- `apps/cli/src/index.ts`
- `apps/cli/src/main.ts`
- `apps/cli/src/commands/command.ts`
- `apps/cli/src/commands/debugBundle.ts`
- `apps/cli/src/commands/debugTrace.ts`
- `apps/cli/src/commands/doctor.ts`
- `apps/cli/src/commands/observer.ts`
- `apps/cli/src/commands/tui.ts`

## Scope Notes

- There is no root `cli/` directory in this worktree; the CLI package is `apps/cli`.
- Files under `apps/cli/test` and `apps/cli/test/fixtures` were treated as test files and excluded from the audited-file set. They were only searched to identify current public-barrel consumers for CLI-1.
