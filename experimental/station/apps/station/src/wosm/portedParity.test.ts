import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WOSM_VIEW_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(WOSM_VIEW_ROOT, "../../../../../..");
const PORTED_ROOT = join(WOSM_VIEW_ROOT, "ported");
const UPSTREAM_ROOT = join(REPO_ROOT, "apps/tui/src");

const ADAPTED_FILES = new Set(["state/store.ts", "state/store.test.ts"]);
const EXTRACTED_FILES = new Set([
  "components/BottomSheetFrame/layout.ts",
  "components/Dashboard/content.ts",
  "components/HelpOverlay/helpPanel.ts",
  "components/ToastOverlay/content.ts",
  "components/WorktreeRow/rowInput.ts",
]);

describe("ported apps/tui logic parity", () => {
  it("matches upstream except documented adaptations", () => {
    const failures: string[] = [];

    for (const file of walkTs(PORTED_ROOT)) {
      const rel = relative(PORTED_ROOT, file);
      const upstream = join(UPSTREAM_ROOT, rel);

      if (EXTRACTED_FILES.has(rel)) {
        if (existsSync(upstream)) {
          failures.push(`${rel} is marked extracted but now has an upstream file`);
        }
        continue;
      }

      if (!existsSync(upstream)) {
        failures.push(`${rel} has no upstream apps/tui file and is not documented as extracted`);
        continue;
      }

      if (ADAPTED_FILES.has(rel)) {
        const header = readFileSync(file, "utf8").split("\n")[0];
        if (!header.startsWith(`// ADAPTED from apps/tui/src/${rel}`)) {
          failures.push(`${rel} is adapted but missing the ADAPTED provenance header`);
        }
        continue;
      }

      const expected = normalizeUpstream(readFileSync(upstream, "utf8"));
      const actual = readFileSync(file, "utf8");
      if (actual !== expected) {
        failures.push(`${rel} differs from apps/tui/src/${rel}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

function walkTs(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTs(path));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

function normalizeUpstream(source: string): string {
  return source.replaceAll('from "vitest"', 'from "bun:test"');
}
