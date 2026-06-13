// Resolves a project's default harness id to the bare interactive launch
// command Station spawns in a local PTY. Station depends only on
// @wosm/contracts / @wosm/dashboard-core, never integrations/harness/*, so this
// is a deliberate tiny re-implementation of each provider's `command()` default
// (the interactive launch is the bare binary with no args). Keep the table in
// step with the providers' defaults in integrations/harness/<id>/src/provider.ts.

export type HarnessSpawn = { command: string; args: readonly string[] };

type HarnessDefault = { defaultCommand: string; envVar: string };

// Mirrors each provider's `command()` default binary + `WOSM_*_BIN` env var.
// The cursor harness id launches the `agent` binary (WOSM_CURSOR_AGENT_BIN).
// A Map (not a plain object) so a harness id colliding with an Object.prototype
// member ("constructor", "toString", …) reads as an unknown id, not an
// inherited member that would slip past the undefined guard below.
const HARNESS_DEFAULTS: ReadonlyMap<string, HarnessDefault> = new Map([
  ["claude", { defaultCommand: "claude", envVar: "WOSM_CLAUDE_BIN" }],
  ["codex", { defaultCommand: "codex", envVar: "WOSM_CODEX_BIN" }],
  ["opencode", { defaultCommand: "opencode", envVar: "WOSM_OPENCODE_BIN" }],
  ["pi", { defaultCommand: "pi", envVar: "WOSM_PI_BIN" }],
  ["cursor", { defaultCommand: "agent", envVar: "WOSM_CURSOR_AGENT_BIN" }],
]);

/**
 * The bare launch command for a harness id, or `undefined` when the id is
 * unknown (the caller surfaces an inert click + toast). The env override uses
 * `||`, not `??` — deliberately diverging from the providers' `?? process.env[…]
 * ?? default` so an empty `WOSM_*_BIN` reads as unset and falls back to the
 * default rather than spawning an empty command. Do not "align" it to `??`.
 */
export function resolveHarnessCommand(harness: string): HarnessSpawn | undefined {
  const entry = HARNESS_DEFAULTS.get(harness);
  if (entry === undefined) {
    return undefined;
  }
  return { command: process.env[entry.envVar] || entry.defaultCommand, args: [] };
}
