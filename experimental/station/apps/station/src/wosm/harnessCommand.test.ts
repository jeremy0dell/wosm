import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolveHarnessCommand } from "./harnessCommand.js";

// The resolver reads process.env at call time and honors the WOSM_*_BIN
// overrides, so the suite must run against a known-clean baseline: snapshot
// every managed key, clear it before each test, and restore the exact prior
// value after. This keeps the baseline "bare command" assertions hermetic on a
// machine that happens to export one of these, and never leaks a mutation to
// other suites in the same process.
const MANAGED_ENV = [
  "WOSM_CLAUDE_BIN",
  "WOSM_CODEX_BIN",
  "WOSM_OPENCODE_BIN",
  "WOSM_PI_BIN",
  "WOSM_CURSOR_AGENT_BIN",
] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of MANAGED_ENV) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, saved] of savedEnv) {
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
  savedEnv.clear();
});

// beforeEach already snapshotted + cleared the key, so this only sets the value.
function setEnv(key: (typeof MANAGED_ENV)[number], value: string): void {
  process.env[key] = value;
}

describe("resolveHarnessCommand", () => {
  it("maps each known harness id to its bare command with no args", () => {
    expect(resolveHarnessCommand("claude")).toEqual({ command: "claude", args: [] });
    expect(resolveHarnessCommand("codex")).toEqual({ command: "codex", args: [] });
    expect(resolveHarnessCommand("opencode")).toEqual({ command: "opencode", args: [] });
    expect(resolveHarnessCommand("pi")).toEqual({ command: "pi", args: [] });
    // The cursor harness launches the `agent` binary.
    expect(resolveHarnessCommand("cursor")).toEqual({ command: "agent", args: [] });
  });

  it("honors the WOSM_*_BIN env override", () => {
    setEnv("WOSM_CLAUDE_BIN", "/opt/bin/claude-next");
    expect(resolveHarnessCommand("claude")).toEqual({
      command: "/opt/bin/claude-next",
      args: [],
    });
  });

  it("treats an empty env override as unset and falls back to the default", () => {
    setEnv("WOSM_CODEX_BIN", "");
    expect(resolveHarnessCommand("codex")).toEqual({ command: "codex", args: [] });
  });

  it("returns undefined for an unknown harness id", () => {
    expect(resolveHarnessCommand("ghost")).toBeUndefined();
    expect(resolveHarnessCommand("")).toBeUndefined();
  });

  it("treats harness ids colliding with Object.prototype members as unknown", () => {
    // A plain-object lookup would resolve these to inherited members (a truthy
    // value), slipping past the unknown-id guard; a Map keeps them unknown.
    for (const id of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(resolveHarnessCommand(id)).toBeUndefined();
    }
  });
});
