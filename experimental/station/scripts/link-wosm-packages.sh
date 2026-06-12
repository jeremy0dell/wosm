#!/usr/bin/env bash
set -euo pipefail

# Station consumes the built @wosm packages by symlinking them into its
# node_modules. Bun's `file:` dependencies copy the package directory without
# its transitive graph, and Bun's `link:` protocol routes through the global
# `bun link` registry, so neither resolves @wosm/client's workspace:*
# dependencies from this isolated workspace. A plain relative symlink does:
# the linked package keeps its real location, so @wosm/protocol, @wosm/runtime,
# effect, string-width, zustand, and zod all resolve through the repo's own
# pnpm node_modules layout.
#
# Re-run after `bun install` (bun prunes unknown node_modules entries); the
# package.json scripts that need the packages chain this script first.

station_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${station_root}/../.." && pwd)"
target_dir="${station_root}/apps/station/node_modules/@wosm"

linked_packages=(client contracts dashboard-core runtime)

for package in "${linked_packages[@]}"; do
  dist_entry="${repo_root}/packages/${package}/dist/index.js"
  if [[ ! -f "${dist_entry}" ]]; then
    cat >&2 <<EOF
${dist_entry} is missing.

Station consumes the built @wosm/${package} package. Build the workspace
packages at the repo root first:

  cd ${repo_root}
  pnpm install
  pnpm build
EOF
    exit 1
  fi
done

mkdir -p "${target_dir}"
for package in "${linked_packages[@]}"; do
  ln -sfn "../../../../../../packages/${package}" "${target_dir}/${package}"
done

# Echo each linked dist's mtime so a stale build is visible at link time —
# the existence check above cannot tell yesterday's dist from today's.
freshness=""
for package in "${linked_packages[@]}"; do
  dist_entry="${repo_root}/packages/${package}/dist/index.js"
  mtime="$(date -r "${dist_entry}" "+%Y-%m-%d %H:%M" 2>/dev/null || stat -c "%y" "${dist_entry}" 2>/dev/null | cut -c1-16)"
  freshness="${freshness}${package}@${mtime}  "
done

echo "Linked @wosm/{client,contracts,dashboard-core,runtime} into apps/station/node_modules."
echo "dist builds: ${freshness}"
