import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const forbiddenImports = [
  "@wosm/worktrunk",
  "@wosm/tmux",
  "@wosm/codex",
  "@wosm/opencode",
  "@wosm/observer",
  "integrations/",
  "sqlite",
];

const forbiddenRuntimeStrings = ["providerData", "inspect panel", "debug panel"];

describe("TUI import boundaries", () => {
  it("keeps provider and observer internals out of apps/tui/src", async () => {
    const files = await sourceFiles(join(process.cwd(), "apps/tui/src"));
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const path = relative(process.cwd(), file);
      for (const forbidden of forbiddenImports) {
        if (source.includes(forbidden)) {
          violations.push(`${path}: forbidden import or reference ${forbidden}`);
        }
      }
      for (const forbidden of forbiddenRuntimeStrings) {
        if (source.includes(forbidden)) {
          violations.push(`${path}: forbidden provider/debug UI string ${forbidden}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return nested.flat().filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
}
