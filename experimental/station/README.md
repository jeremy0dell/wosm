# WOSM Station Experiment

This is the isolated Station spike. It is intentionally outside the root pnpm
workspace so OpenTUI, Bun, native renderer requirements, and future PTY
dependencies cannot leak into normal WOSM development.

## Runtime

- Bun: `1.3.14`
- OpenTUI: `@opentui/core@0.4.0`, `@opentui/react@0.4.0`
- React: `19.2.7`

The host scripts check dependencies and fail clearly. They do not install Bun,
Node, Zig, OpenTUI, or native requirements on the host machine.

## Run In Container

```bash
experimental/station/scripts/run-container.sh
experimental/station/scripts/run-container.sh --hot
```

The container lane uses named Docker volumes for `node_modules` and Bun cache.
It is the preferred dependency-isolation path.

## Run On Host

```bash
experimental/station/scripts/doctor.sh
experimental/station/scripts/run-host.sh
experimental/station/scripts/run-host.sh --hot
```

Host mode requires Bun `1.3.14` to already be active. It is for explicit local
lab work only.

## Manual Verification

Run the Station app and verify:

- the terminal enters a full-screen OpenTUI view
- a top bar labeled `WOSM Station` renders
- one bordered pane renders
- the pane shows `Hello world from Station`
- terminal resize keeps the pane visible
- `Ctrl-C` exits back to the shell
