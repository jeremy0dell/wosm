# Project Extensibility And Worktree Materialization Plan

**Status:** Planning addendum  
**Date:** 2026-05-26  
**Severity:** P1 product architecture gap  
**Applies to:** project config, worktree lifecycle, agent setup, CLI commands, diagnostics  
**Source baseline:** `docs/planning/wosm_rebuild_tdd_final_v1.md` and `docs/planning/wosm_phased_development_cycle_final_v1.md`

This document defines the target shape for project-level extensibility in wosm.

The motivating problem is that real projects need more than a clean Git worktree and a terminal pane. A worktree may need the correct Node or package-manager environment, symlinked files, copied agent commands, generated local config, Git exclude entries, dependency installation, or project-specific setup scripts before an agent can work safely.

The important product rule:

```text
Extensibility is a first-class wosm surface, not an accidental shell-profile dependency.
```

wosm should provide typed primitives for common setup tasks and an explicit arbitrary-code escape hatch for project-specific behavior. Arbitrary shell, TypeScript, or other project scripts are allowed, but they must be scoped, observable, repeatable, and diagnosable.

## 1. Problem

The current command environment can become noisy and brittle:

```text
env PATH=/opt/homebrew/opt/node@24/bin:/Users/.../pnpm:/usr/local/bin:/usr/bin:/bin pnpm ...
```

That happens because agent-run commands often execute without the user's interactive shell startup files. The command must still find the intended Node, pnpm, package binaries, and local project tooling.

This is not just cosmetic. Once wosm manages multiple projects, each project may need a different setup model:

```text
project A uses pnpm and Homebrew Node
project B uses mise
project C uses asdf
project D uses a repo-local tool wrapper
project E needs generated agent command files in every worktree
project F needs local-only paths added to Git exclude
```

A Git worktree does not automatically mean the agent runtime is ready. It shares repository history, but each worktree can still need project-specific materialization before use.

## 2. Target Concept

Introduce a project-level worktree materialization layer.

Materialization means:

```text
Given a configured project and a discovered or newly created worktree,
make that worktree locally usable for wosm-managed agent work.
```

It may include:

```text
resolve the expected toolchain environment
copy or symlink local files
write provider-specific agent assets
update Git exclude for local-only files
run dependency/bootstrap commands
run arbitrary project scripts
check whether the worktree is already prepared
record diagnostics for every step
```

Materialization is not the source of truth for Git, terminal topology, harness status, or observer graph state. It is preparation around worktree usability.

## 3. Design Goals

- Make multi-project command execution predictable without hardcoded global PATH prefixes.
- Let projects define how worktrees become usable for agents.
- Support declarative setup for common cases.
- Support arbitrary shell, TypeScript, or other scripts for project-specific cases.
- Keep provider-specific behavior behind provider or project-extension boundaries.
- Make setup idempotent by design and checkable by `wosm doctor`.
- Capture stdout, stderr, exit code, duration, trace ids, and diagnostics for every materialization step.
- Avoid rebuilding the old shell backend as hidden global workflow logic.

## 4. Non-Goals

- Do not make observer/core import Codex, OpenCode, tmux, Worktrunk, Node, pnpm, mise, asdf, or shell-specific behavior directly.
- Do not require every project to use wosm-specific scripts.
- Do not silently mutate worktrees without explicit project configuration.
- Do not treat scripts as authoritative state. Reconcile still comes from config, providers, SQLite history, and provider observations.
- Do not assume `.git` is a directory in a worktree.

## 5. Config Shape

The final schema can change, but the product surface should support this kind of shape:

```toml
[projects.wosm.environment]
toolchain = "mise"
profile = "default"

[projects.wosm.commands]
bootstrap = "pnpm install --frozen-lockfile"
build = "pnpm build"
test = "pnpm test:all"
lint = "pnpm exec biome check ."

[projects.wosm.prepare]
on_worktree_create = true
on_worktree_discover = "check"
timeout_ms = 60000

[[projects.wosm.prepare.steps]]
kind = "git-exclude"
path = ".codex/commands"

[[projects.wosm.prepare.steps]]
kind = "copy"
source = ".wosm/codex/commands"
target = ".codex/commands"
provider = "codex"

[[projects.wosm.prepare.steps]]
kind = "symlink"
source = "../../shared/pnpm-lock.yaml"
target = "pnpm-lock.yaml"

[[projects.wosm.prepare.steps]]
kind = "shell"
name = "install deps"
command = "pnpm install --frozen-lockfile"

[[projects.wosm.prepare.steps]]
kind = "node"
name = "copy agent commands"
entry = ".wosm/scripts/copy-agent-commands.ts"
```

The important split:

```text
environment: how commands find tools
commands: named project commands agents/TUI/CLI can request
prepare: how a worktree is materialized for agent work
```

## 6. Declarative Steps

wosm should provide typed primitives for common operations because they are easier to validate, render, diagnose, and dry-run than arbitrary shell.

Initial step kinds:

```text
copy
symlink
git-exclude
mkdir
write-file
shell
node
```

Likely future step kinds:

```text
provider-asset
package-install
command
check-file
check-command
template
```

Declarative steps should be idempotent where possible:

```text
copy: update only when content differs
symlink: replace only when target is missing or wrong and policy allows it
git-exclude: add line only when absent
mkdir: no-op when directory exists
write-file: update only when content differs
```

When a step cannot be made safely idempotent, it should say so in diagnostics.

## 7. Arbitrary Script Steps

Arbitrary code should be a supported extension point.

Supported drivers may include:

```text
shell
node
tsx or TypeScript runner when available
project-defined command
```

Script steps should receive a stable environment:

```text
WOSM_PROJECT_ID
WOSM_PROJECT_ROOT
WOSM_WORKTREE_ID
WOSM_WORKTREE_PATH
WOSM_BRANCH
WOSM_STATE_DIR
WOSM_PROVIDER_KIND
WOSM_TERMINAL_PROVIDER
WOSM_HARNESS_PROVIDER
WOSM_PREPARE_REASON
```

Script execution requirements:

```text
bounded timeout
working directory is explicit
stdout and stderr captured
exit code captured
trace/span ids recorded
safe error returned on failure
diagnostic id emitted when useful
debug bundle includes recent prepare steps
```

Arbitrary scripts should be treated like provider boundaries:

```text
trusted local project code
not core logic
observable
timeout-bounded
diagnosable
```

## 8. Git Exclude Handling

wosm must not assume `.git/info/exclude` is available under the worktree path. Linked worktrees often have a `.git` file that points elsewhere.

The correct operation is:

```text
git -C <worktree> rev-parse --git-path info/exclude
```

Then wosm can add local-only paths idempotently.

This matters for agent-specific files such as:

```text
.codex/commands
.opencode/commands
.wosm/local
generated setup markers
```

Git exclude mutations should be explicit in config and visible in diagnostics.

## 9. Provider Assets

Provider-specific agent assets must stay out of observer/core.

Examples:

```text
Codex command files
OpenCode command files
provider hook templates
provider-specific launch wrappers
```

The contract should let a project or provider declare assets, but core should apply generic materialization actions:

```text
copy this directory
symlink this file
add this path to Git exclude
run this command
```

Provider integrations may contribute recommended prepare steps, but observer/core should only see typed, provider-neutral materialization requests.

## 10. Environment Resolution

wosm should avoid hardcoding long PATH prefixes into every command when a project-level environment profile can express the intent.

Possible environment sources:

```text
explicit config env vars
packageManager from package.json
.node-version
.nvmrc
mise.toml
.tool-versions
project command wrappers
user-provided env script
```

The environment resolver should produce:

```ts
type ProjectCommandEnvironment = {
  cwd: string;
  env: Record<string, string>;
  pathPrepend: string[];
  diagnostics: SafeError[];
};
```

The exact type can change, but the resolved environment should be inspectable through `wosm doctor` and debug bundles.

## 11. Commands As Product Surface

Project commands should become named, reusable product concepts:

```text
bootstrap
build
test
lint
format
doctor
```

Agents and UI flows should be able to request a named command without embedding project-specific tool details.

Examples:

```text
wosm project command wosm build
wosm project command wosm test --worktree <id>
TUI action: run test in selected worktree
agent instruction: use project command "lint"
```

Named commands should run through the same environment resolver and diagnostics pipeline as prepare steps.

## 12. Lifecycle Hooks

Materialization can run at several points:

```text
project discovery
worktree discovery
worktree create
session create
session startAgent
manual prepare command
doctor check
```

Default behavior should be conservative:

```text
on worktree create: allowed when configured
on worktree discover: check by default, mutate only when configured
on session start: fail fast or warn based on project policy
manual prepare: always explicit
```

Possible commands:

```text
wosm prepare
wosm prepare --project <id>
wosm prepare --worktree <id>
wosm prepare --check
wosm doctor
```

## 13. State And Markers

wosm may store local preparation state under observer state, not as the source of truth:

```text
state/preparation/<project>/<worktree>.json
```

It may also support optional in-worktree marker files when configured:

```text
.wosm/local/prepared.json
```

Marker files are diagnostics and optimization hints only. The actual check should be able to re-evaluate the worktree.

## 14. Failure Policy

Failure behavior should be explicit.

Possible policies:

```text
warn
block-session-start
block-agent-launch
ignore
```

Recommended defaults:

```text
manual prepare failure: nonzero CLI exit
worktree create prepare failure: command failure unless configured warn
worktree discover check failure: warning/doctor issue
session start with failed required prepare: block
optional provider asset failure: warn unless required
```

Every failure should produce a SafeError and enough context for `wosm debug bundle`.

## 15. Observability

Materialization must integrate with existing observability expectations.

Each run should record:

```text
prepare run id
project id
worktree id/path
reason
step name/type
startedAt/completedAt
duration
status
exit code
stdout/stderr excerpts
trace/span ids
diagnostic id when needed
```

Debug bundle should include:

```text
recent prepare runs
failed prepare steps
project command runs
resolved environment summary
redacted command lines
git exclude modifications
provider asset materialization records
```

## 16. Boundary Rules

Core rules:

```text
Config declares project extension intent.
Observer records command lifecycle and diagnostics.
Worktree provider owns worktree creation/discovery.
Terminal provider owns terminal topology.
Harness provider owns harness semantics.
Materialization owns local worktree preparation.
Provider integrations may contribute prepare steps.
Observer/core applies only provider-neutral materialization operations.
```

This preserves the baseline ownership model while acknowledging that real projects need local setup code.

## 17. Testing Strategy

Test with fakes before real tools.

Unit tests:

```text
config schema parses prepare steps
git exclude path resolves through fake git runner
copy/symlink steps are idempotent
script step builds stable env
environment resolver preserves absent vs undefined optional fields
```

Integration tests:

```text
wosm prepare --check reports missing materialization
wosm prepare applies copy/symlink/git-exclude steps
failed shell step records SafeError and diagnostic id
session start blocks when required prepare failed
debug bundle includes prepare evidence
```

E2E/scripted tests:

```text
new worktree gets agent command assets
new worktree can run configured project command
different projects resolve different command environments
linked worktree Git exclude is updated correctly
```

## 18. Implementation Sequence

Recommended build order:

1. Add config schema and contract types for project commands and prepare steps.
2. Add pure materialization planner that turns config plus worktree context into typed steps.
3. Add fake runner and unit tests for copy, symlink, git-exclude, and shell step behavior.
4. Add `wosm prepare --check` with diagnostics only.
5. Add `wosm prepare` mutation path.
6. Record prepare runs in local state and debug bundle.
7. Integrate required prepare checks into session creation/start.
8. Add provider-contributed assets for Codex/OpenCode command files as a later provider-scoped slice.

Do not start by embedding more PATH prefixes into command strings. The product target is named project commands plus resolved project environments.

## 19. Open Questions

- Should prepare config live only in `config.toml`, or may repos also define `.wosm/commands.toml`?
- Should repo-local `.wosm` files be trusted automatically for configured projects, or require an explicit trust flag?
- Which script drivers are supported in MVP: shell only, Node, TypeScript, or all three?
- Should materialization run inside observer, CLI, or a separate local worker abstraction?
- Should failed optional prepare steps appear as TUI alerts, doctor warnings, or both?
- How should secrets be redacted from command lines and script output beyond existing debug-bundle redaction?

