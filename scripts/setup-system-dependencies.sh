#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
assume_yes=0
check_only=0
run_brew=1
run_shell_integration=1

usage() {
  cat <<'EOF'
Usage: scripts/setup-system-dependencies.sh [options]

Installs and checks external provider tools used by wosm.

Options:
  --check                    Check dependencies without installing.
  --yes                     Answer yes to Worktrunk shell integration prompts.
  --no-brew                 Skip Homebrew bundle install/check.
  --skip-shell-integration  Skip `wt config shell install`.
  -h, --help                Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      check_only=1
      ;;
    --yes|-y)
      assume_yes=1
      ;;
    --no-brew)
      run_brew=0
      ;;
    --skip-shell-integration)
      run_shell_integration=0
      ;;
    --)
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

run() {
  printf '+ %s\n' "$*"
  "$@"
}

require_command() {
  local command_name="$1"
  local install_hint="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command '$command_name' was not found on PATH." >&2
    echo "$install_hint" >&2
    exit 1
  fi
}

require_node_24() {
  require_command node "Install Node.js 24.x before running wosm."
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$node_major" != "24" ]]; then
    echo "Node.js 24.x is required. Found: $(node --version)" >&2
    exit 1
  fi
  run node --version
}

require_pnpm_11() {
  require_command pnpm "Install pnpm 11 before running wosm."
  local pnpm_major
  pnpm_major="$(pnpm --version | cut -d. -f1)"
  if [[ "$pnpm_major" != "11" ]]; then
    echo "pnpm 11 is required. Found: $(pnpm --version)" >&2
    exit 1
  fi
  run pnpm --version
}

require_node_24
require_pnpm_11

if [[ "$run_brew" -eq 1 ]]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required for Brewfile setup. Install Homebrew or rerun with --no-brew." >&2
    exit 1
  fi

  if [[ "$check_only" -eq 1 ]]; then
    run brew bundle check --file "$repo_root/Brewfile"
  else
    run brew bundle install --file "$repo_root/Brewfile"
  fi
fi

require_command wt "Install Worktrunk with: brew bundle install --file \"$repo_root/Brewfile\""
require_command tmux "Install tmux with: brew bundle install --file \"$repo_root/Brewfile\""

run wt --version
run tmux -V

if [[ "$check_only" -eq 1 ]]; then
  echo "Dependency check passed. Shell integration is not modified in --check mode."
  exit 0
fi

if [[ "$run_shell_integration" -eq 1 ]]; then
  if [[ "$assume_yes" -eq 1 ]]; then
    printf '+ printf "y\\n" | wt config shell install\n'
    printf 'y\n' | wt config shell install
  else
    run wt config shell install
  fi
fi

cat <<'EOF'
System dependency setup complete.

Restart the observer before manual testing:
  wosm observer stop
  wosm doctor
EOF
