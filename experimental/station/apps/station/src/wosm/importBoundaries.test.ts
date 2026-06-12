// Enforces the experiment's dependency-isolation rules where root CI cannot
// (Station is excluded from it): the WOSM view may consume only the built,
// link-script-provided @wosm packages; apps/tui is copy provenance, never an
// import; and the ported logic layer stays render-framework-free so its
// extraction into a shared package at the spike verdict stays mechanical.
// The focusable scan guards the one-focus-system decision: OpenTUI's
// focusable/focus() must stay unused (the coordination store owns focus).
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const WOSM_ROOT = new URL(".", import.meta.url).pathname;
const LINKED_WOSM_PACKAGES = new Set(["client", "contracts", "runtime"]);

function wosmSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(path);
      }
    }
  };
  walk(WOSM_ROOT);
  return files;
}

function importsOf(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const specifiers: string[] = [];
  const importPattern = /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

describe("wosm view import boundaries", () => {
  const files = wosmSourceFiles();

  it("finds the wosm tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("never imports from apps/tui or ink", () => {
    const failures: string[] = [];
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        if (specifier.includes("apps/tui") || specifier === "ink" || specifier.startsWith("ink/")) {
          failures.push(`${relative(WOSM_ROOT, file)} imports ${specifier}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("only uses @wosm packages provided by the link script", () => {
    const failures: string[] = [];
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith("@wosm/")) {
          continue;
        }
        const packageName = specifier.split("/")[1] ?? "";
        if (!LINKED_WOSM_PACKAGES.has(packageName)) {
          failures.push(`${relative(WOSM_ROOT, file)} imports ${specifier}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps the ported logic layer free of render frameworks", () => {
    const failures: string[] = [];
    for (const file of files) {
      const rel = relative(WOSM_ROOT, file);
      if (!rel.startsWith("ported/")) {
        continue;
      }
      for (const specifier of importsOf(file)) {
        if (
          specifier.startsWith("@opentui/") ||
          specifier === "react" ||
          specifier.startsWith("react/") ||
          specifier.startsWith("react-")
        ) {
          failures.push(`${rel} imports ${specifier}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("never sets the focusable prop (the coordination store owns focus)", () => {
    const failures: string[] = [];
    for (const file of files) {
      if (!file.endsWith(".tsx")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (/\bfocusable\s*[=:]/.test(source) && !/focusable:\s*false/.test(source)) {
        failures.push(relative(WOSM_ROOT, file));
      }
    }
    expect(failures).toEqual([]);
  });
});
