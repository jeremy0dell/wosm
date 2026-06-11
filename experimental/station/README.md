# WOSM Station Experiment

This is the isolated Station spike. It is intentionally outside the root pnpm
workspace so OpenTUI, Bun, native renderer requirements, and future PTY
dependencies cannot leak into normal WOSM development.

## Runtime

- Bun: `1.3.14`
- Node: required for the Station-local `node-pty` sidecar
- OpenTUI: `@opentui/core@0.4.0`, `@opentui/react@0.4.0`
- React: `19.2.7`

The host scripts check dependencies and fail clearly. They do not install Bun,
Node, Zig, OpenTUI, or native requirements on the host machine.

## Run In Container

```bash
experimental/station/scripts/run-container.sh
experimental/station/scripts/run-container.sh --mock
experimental/station/scripts/run-container.sh --hot
experimental/station/scripts/run-container.sh --mock --hot
experimental/station/scripts/run-container.sh --hot --mock
```

The container lane uses named Docker volumes for `node_modules` and Bun cache.
It is the preferred dependency-isolation path.

## Run On Host

```bash
experimental/station/scripts/doctor.sh
experimental/station/scripts/run-host.sh
experimental/station/scripts/run-host.sh --mock
experimental/station/scripts/run-host.sh --hot
experimental/station/scripts/run-host.sh --hot --mock
```

Host mode requires Bun `1.3.14` and Node to already be active. Set
`WOSM_STATION_NODE=/path/to/node` to override the Node executable used by the
PTY sidecar. Host mode is for explicit local lab work only.

## WOSM State Source

`Ctrl-O` toggles the read-only WOSM mode overlay above the shell pane: live
projects, worktrees, sessions, and agent statuses plus a calm connection
status line. While the overlay is up, input is swallowed (the hidden shell
cannot receive keystrokes) until `Ctrl-O` returns to the pane.

`WOSM_STATION_SOURCE` selects where that state comes from.

- unset, empty, or `observer`: connect to the local observer through the
  shared `@wosm/client` runtime. The socket path is
  `WOSM_OBSERVER_SOCKET_PATH` if set, else `$XDG_RUNTIME_DIR/wosm/observer.sock`,
  else `~/.local/state/wosm/run/observer.sock` (mirrors the repo's
  `@wosm/config` resolution). With no observer running, the overlay shows a
  calm `reconnecting since …` line; if the observer goes away later, the last
  good snapshot stays visible with a `display-only` status.
- `mock`: serve the Station-owned, contract-shaped fixture without touching
  any socket.

Examples:

```bash
WOSM_STATION_SOURCE=mock experimental/station/scripts/run-host.sh
experimental/station/scripts/run-container.sh --mock
```

Bun also loads local env files, so `experimental/station/.env.local` can hold
`WOSM_STATION_SOURCE=mock` for local Station lab work.

## Consuming The Shared @wosm Packages

Live observer mode consumes the repo's built packages: `@wosm/client` plus its
`@wosm/contracts`, `@wosm/protocol`, and `@wosm/runtime` graph. Build them at
the repo root before running Station:

```bash
pnpm install
pnpm build
```

`scripts/link-wosm-packages.sh` symlinks `@wosm/client` and `@wosm/contracts`
into `apps/station/node_modules`; the linked packages resolve their own
dependencies through the repo's pnpm layout. Bun's `file:` dependencies copy
the package without its transitive graph and Bun's `link:` protocol routes
through the global `bun link` registry, so neither works from this isolated
workspace — the symlink script is the proven mechanism. `bun install` prunes
the links, so every package script that needs them (`station`, `dev`, `test`,
`typecheck`) re-runs the link script first, and `scripts/doctor.sh` checks the
dists exist. The container lane mounts the repo root so the same links resolve
inside the container.

## Terminal PTY Spike

The Station app has a local `src/terminal/` boundary for creating PTYs. The
first backend uses `node-pty`; it is intentionally app-local while Station
proves pane/runtime behavior.

### 2026-06-11 POC Status

This commit proves the first Station PTY path end to end:

- Station opens directly into a PTY-backed terminal pane.
- Bun owns the OpenTUI process.
- A small Node sidecar owns `node-pty`.
- Raw OpenTUI input is forwarded to the active PTY.
- `Ctrl-Q` is reserved for Station exit.
- `Ctrl-C` is forwarded to the shell.

This is a POC success with known rendering bugs. The current pane strips ANSI
and renders recent text into an OpenTUI text node; it is not a terminal screen
model. Do not file individual formatting issues for cursor movement, wrapping,
alternate screen, shell prompt redraws, colors, or full-screen terminal apps
until Station has a real VT parser / terminal buffer.

Run the explicit smoke probe with:

```bash
cd experimental/station
bun run test:pty
```

If this fails, keep the failure local to Station. Do not promote PTY runtime
work into shared WOSM packages until Bun, native dependency, and output
streaming behavior are proven.

The smoke command runs a Station-local `node-pty` repair first because Bun can
extract `spawn-helper` without its executable bit. Station runs `node-pty` in a
Node sidecar while Bun owns the OpenTUI process. Keep those workarounds local to
the experiment.

## Manual Verification

Run the Station app and verify:

- the terminal enters a full-screen OpenTUI view
- a top bar labeled `WOSM Station` renders
- one bordered terminal pane renders with a shell process id in the title
- typed shell commands echo and render output in the pane
- `Ctrl-C` is delivered to the shell process
- `Ctrl-Q` exits back to the shell
- terminal resize keeps the pane visible
