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

## Snapshot Source

Station reads one snapshot at startup from `WOSM_STATION_SOURCE`.

- unset, empty, or `observer`: render the not-yet-connected observer source as
  formatted `{}`
- `mock`: render the Station-owned fake observer snapshot fixture

Examples:

```bash
WOSM_STATION_SOURCE=mock experimental/station/scripts/run-host.sh
experimental/station/scripts/run-container.sh --mock
```

Bun also loads local env files, so `experimental/station/.env.local` can hold
`WOSM_STATION_SOURCE=mock` for local Station lab work.

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
