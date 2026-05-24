import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const forbiddenPackages = ["@wosm/cli", "@wosm/observer", "@wosm/tui"] as const;
const packageRoot = new URL("../..", import.meta.url);

describe("hook bridge package boundaries", () => {
  it("does not depend on CLI, observer, or TUI packages", async () => {
    const manifest = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };

    for (const packageName of forbiddenPackages) {
      expect(dependencies).not.toHaveProperty(packageName);
    }
  });

  it("does not import CLI, observer, or TUI source", async () => {
    const sourceFiles = await listSourceFiles(new URL("src", packageRoot));
    const sources = await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")));
    const source = sources.join("\n");

    for (const packageName of forbiddenPackages) {
      expect(source).not.toContain(`"${packageName}`);
      expect(source).not.toContain(`'${packageName}`);
    }
  });
});

async function listSourceFiles(directory: URL): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory.pathname, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(new URL(`${entry.name}/`, directory))));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}
