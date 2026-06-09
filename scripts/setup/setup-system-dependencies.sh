#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
entry="$repo_root/apps/cli/dist/main.js"
args=(setup system)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      args+=(--check)
      ;;
    --yes|-y)
      args+=(--yes)
      ;;
    --no-brew)
      args+=(--no-brew)
      ;;
    -h|--help)
      "$repo_root/bin/wosm" setup system --help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      "$repo_root/bin/wosm" setup system --help >&2
      exit 2
      ;;
  esac
  shift
done

if [[ ! -f "$entry" ]]; then
  echo "wosm has not been built. Run: pnpm build" >&2
  exit 1
fi

exec "$repo_root/bin/wosm" "${args[@]}"
