import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider hook ingress removal guard", () => {
  it("keeps generated provider hook paths off the removed wosm-hook bridge", async () => {
    const productionFiles = [
      "integrations/harness/codex/src/hooks/hookScript.ts",
      "integrations/worktree/worktrunk/src/hooks.ts",
      "integrations/harness/pi/src/piExtension.ts",
      "package.json",
    ];
    const violations: string[] = [];

    for (const relativePath of productionFiles) {
      const source = await readFile(join(process.cwd(), relativePath), "utf8");
      if (source.includes("wosm-hook")) {
        violations.push(`${relativePath}: wosm-hook`);
      }
      if (source.includes("wosm hook")) {
        violations.push(`${relativePath}: wosm hook`);
      }
    }

    await expect(access(join(process.cwd(), "bin", "wosm-hook"))).rejects.toThrow();
    await expect(access(join(process.cwd(), "apps", "hook-runner"))).rejects.toThrow();
    await expect(access(join(process.cwd(), "packages", "hook-bridge"))).rejects.toThrow();
    expect(violations).toEqual([]);
  });
});
