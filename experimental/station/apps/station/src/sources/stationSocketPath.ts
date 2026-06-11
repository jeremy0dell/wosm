import { join } from "node:path";

/**
 * Mirrors the default observer socket resolution in
 * packages/config/src/observerPaths.ts without pulling @wosm/config into the
 * spike: explicit env override, then the XDG runtime dir, then the default
 * state dir. Custom config-file socket paths are covered by the env override.
 */
export function resolveStationObserverSocketPath(
  env: Record<string, string | undefined>,
): string {
  const override = env.WOSM_OBSERVER_SOCKET_PATH;
  if (override !== undefined && override.length > 0) {
    return override;
  }

  const runtimeDir = env.XDG_RUNTIME_DIR;
  if (runtimeDir !== undefined && runtimeDir.length > 0) {
    return join(runtimeDir, "wosm", "observer.sock");
  }

  const home = env.HOME;
  if (home === undefined || home.length === 0) {
    throw new Error(
      "Cannot resolve the observer socket path: set WOSM_OBSERVER_SOCKET_PATH or HOME.",
    );
  }

  return join(home, ".local", "state", "wosm", "run", "observer.sock");
}
