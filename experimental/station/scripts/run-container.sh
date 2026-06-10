#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="wosm-station-experiment:local"
script="station"

case "${1:-}" in
  --hot)
    script="dev"
    ;;
  "")
    ;;
  *)
    echo "Usage: $0 [--hot]" >&2
    exit 2
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  cat >&2 <<EOF
Docker is not available on PATH.

Install or start Docker deliberately, or use host mode after activating Bun 1.3.14:

  ${root}/scripts/run-host.sh
EOF
  exit 1
fi

docker build \
  -t "${image}" \
  -f "${root}/.devcontainer/Dockerfile" \
  "${root}"

docker run --rm -it \
  --name wosm-station-experiment \
  --mount "type=bind,src=${root},dst=/workspace/experimental/station" \
  --mount "type=volume,src=wosm-station-node-modules,dst=/workspace/experimental/station/node_modules" \
  --mount "type=volume,src=wosm-station-bun-cache,dst=/home/bun/.bun/install/cache" \
  --workdir /workspace/experimental/station \
  -e TERM="${TERM:-xterm-256color}" \
  "${image}" \
  sh -lc "bun install --frozen-lockfile && bun run ${script}"
