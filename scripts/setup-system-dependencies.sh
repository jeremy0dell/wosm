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

if ! command -v wt >/dev/null 2>&1; then
  echo "Worktrunk binary 'wt' was not found on PATH." >&2
  echo "Install it with: brew bundle install --file \"$repo_root/Brewfile\"" >&2
  exit 1
fi

run wt --version

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
