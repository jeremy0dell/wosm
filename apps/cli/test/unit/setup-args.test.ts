import { describe, expect, it } from "vitest";
import { parseSetupArgs } from "../../src/commands/setup/args.js";

describe("setup args", () => {
  it("parses supported setup commands", () => {
    expect(parseSetupArgs([])).toMatchObject({ kind: "guided" });
    expect(parseSetupArgs(["check", "--json"])).toMatchObject({ kind: "check", json: true });
    expect(parseSetupArgs(["plan", "--json"])).toMatchObject({ kind: "plan", json: true });
    expect(parseSetupArgs(["apply", "--yes"])).toMatchObject({ kind: "apply", yes: true });
    expect(parseSetupArgs(["apply", "--dry-run"])).toMatchObject({
      kind: "apply",
      dryRun: true,
    });
    expect(parseSetupArgs(["system", "--check"])).toMatchObject({ kind: "system", check: true });
  });

  it("validates unsupported flag combinations", () => {
    expect(() => parseSetupArgs(["bogus"])).toThrow("Unknown setup command: bogus");
    expect(() => parseSetupArgs(["check", "--yes"])).toThrow("wosm setup check cannot use --yes.");
    expect(() => parseSetupArgs(["apply"])).toThrow(
      "wosm setup apply requires --yes or --dry-run.",
    );
    expect(() => parseSetupArgs(["system"])).toThrow(
      "wosm setup system requires --check or --yes.",
    );
    expect(() => parseSetupArgs(["apply", "--json"])).toThrow(
      "--json is supported for wosm setup check and wosm setup plan.",
    );
  });
});
