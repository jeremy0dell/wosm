# WOSM Experiments

This directory contains isolated experiments that are not part of the root WOSM
workspace contract.

Rules:

- Do not add `experimental/**` to the root `pnpm-workspace.yaml`.
- Do not make root `pnpm install`, `pnpm build`, `pnpm lint`, or `pnpm test:all`
  depend on anything under this directory.
- Keep experiment-specific lockfiles, runtimes, native dependencies, and
  containers inside the experiment directory.
- Promotion into the normal repo layout requires an explicit product and
  packaging decision.
