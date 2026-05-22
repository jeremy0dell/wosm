# Real Codex Agent Lane

This lane is opt-in and is not part of `test:all`.

Run it only when the local machine has:

- `tmux`
- `codex`
- `codex login status` exiting `0`

```bash
WOSM_REAL_CODEX=1 \
WOSM_CODEX_BIN="$(command -v codex)" \
WOSM_TMUX_BIN="$(command -v tmux)" \
pnpm test:e2e:codex:real
```

The test creates a temporary git worktree, starts a unique tmux session, launches Codex through a temporary shim that logs argv and then `exec`s the real Codex binary, reconciles observer state, and cleans up the tmux/temp state afterward.

The assertion is intentionally conservative: wosm must observe a provider-neutral Codex harness run with `unknown` low-confidence status. The shim log proves tmux executed the Codex launch command; it does not try to prove Codex has a reliable idle/working signal.
