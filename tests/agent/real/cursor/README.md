# Real Cursor Agent Lane

This lane is opt-in and is not part of `test:all`.

Run it only when the local machine has:

- `tmux`
- Cursor Agent `agent`
- `agent --version` exiting `0`

```bash
WOSM_REAL_CURSOR=1 \
WOSM_CURSOR_AGENT_BIN="$(command -v agent)" \
WOSM_TMUX_BIN="$(command -v tmux)" \
pnpm test:e2e:cursor:real
```

The test creates a temporary git worktree, starts a unique tmux session, launches Cursor through a temporary shim that logs argv/env and then `exec`s the real Cursor Agent binary, reconciles observer state, and cleans up the tmux/temp state afterward.

The assertion is intentionally conservative: wosm must observe a provider-neutral Cursor harness run with `unknown` low-confidence status. The shim log and tmux pane/process evidence prove the Cursor launch happened without asserting on Cursor screen text.

This lane does not install or exercise Cursor hooks. Hook-driven state promotion requires manually configuring Cursor to call `wosm-ingress cursor` from `.cursor/hooks.json` or `~/.cursor/hooks.json`.
