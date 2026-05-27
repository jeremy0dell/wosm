import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const roots = ["apps", "packages", "integrations"];
const providerNeutralSourceRoots = [
  "apps/tui/src",
  "packages/contracts/src",
  "packages/hook-bridge/src",
  "packages/observability/src",
  "packages/protocol/src",
  "packages/runtime/src",
];

const tmuxImplementationMarkers = [
  "@wosm/tmux",
  "display-popup",
  "@wosm_popup",
  "@wosm_tui_dev",
  "WOSM_FOCUS_PROVIDER=tmux",
  "WOSM_TMUX_BIN",
];

const setTimeoutAllowlist = new Map([
  [
    "apps/observer/src/runtime/main.ts",
    "One-tick deferral lets observer.stop flush its protocol response before shutdown closes the server.",
  ],
  [
    "apps/tui/src/hooks/useObserverDashboard.ts",
    "Short reconnect backoff is the TUI observer-client subscription boundary, kept out of React presentation components.",
  ],
  [
    "apps/cli/src/commands/tui.ts",
    "Short popup-mode startup defer lets the TUI render a cached snapshot before requesting a nonblocking reconcile.",
  ],
  [
    "apps/observer/src/metadata/gitRefInvalidation.ts",
    "Short debounce coalesces noisy Git ref watch events before requesting an observer-owned metadata reconcile.",
  ],
]);

describe("boundary inventory guard", () => {
  it("keeps timeout and retry plumbing inside explicit runtime boundaries", async () => {
    const files = await sourceFiles();
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const path = relative(process.cwd(), file);

      if (source.includes("Promise.race")) {
        violations.push(`${path}: raw Promise.race`);
      }
      if (source.includes("setInterval(")) {
        violations.push(`${path}: raw setInterval polling`);
      }
      if (source.includes("setTimeout(") && !setTimeoutAllowlist.has(path)) {
        violations.push(`${path}: raw setTimeout without allowlist reason`);
      }
      if (/while\s*\([^)]*Date\.now\(/.test(source)) {
        violations.push(`${path}: deadline loop using Date.now`);
      }
    }

    expect(violations).toEqual([]);
    expect([...setTimeoutAllowlist.values()].every((reason) => reason.length > 20)).toBe(true);
  });

  it("keeps tmux implementation details out of provider-neutral source packages", async () => {
    const files = (
      await Promise.all(
        providerNeutralSourceRoots.map((root) => sourceFilesAt(join(process.cwd(), root))),
      )
    ).flat();
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const path = relative(process.cwd(), file);
      for (const marker of tmuxImplementationMarkers) {
        if (source.includes(marker)) {
          violations.push(`${path}: tmux implementation marker ${marker}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    files.push(...(await sourceFilesAt(join(process.cwd(), root))));
  }
  return files.filter(
    (file) =>
      file.endsWith(".ts") &&
      file.includes("/src/") &&
      !file.includes("/dist/") &&
      !file.endsWith(".d.ts"),
  );
}

async function sourceFilesAt(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? sourceFilesAt(path) : [path];
    }),
  );
  return files.flat();
}
