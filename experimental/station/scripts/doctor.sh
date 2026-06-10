#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_bun="1.3.14"

if ! command -v bun >/dev/null 2>&1; then
  cat >&2 <<EOF
Bun is not available on PATH.

Station host mode requires Bun ${expected_bun}, but this script will not install
it for you. Use the container lane instead:

  ${root}/scripts/run-container.sh
EOF
  exit 1
fi

actual_bun="$(bun --version)"
if [[ "${actual_bun}" != "${expected_bun}" ]]; then
  cat >&2 <<EOF
Bun ${actual_bun} is active, but Station host mode expects Bun ${expected_bun}.

Switch Bun deliberately, or use the isolated container lane:

  ${root}/scripts/run-container.sh
EOF
  exit 1
fi

if [[ ! -f "${root}/bun.lock" ]]; then
  cat >&2 <<EOF
${root}/bun.lock is missing.

Create it from inside the Station experiment with:

  cd ${root}
  bun install
EOF
  exit 1
fi

cat <<EOF
Station experiment checks passed.

Run on host:
  ${root}/scripts/run-host.sh

Run in container:
  ${root}/scripts/run-container.sh
EOF
