#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

"${root}/scripts/doctor.sh"

cd "${root}"
bun install --frozen-lockfile
exec bun run "${script}"
