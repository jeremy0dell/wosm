import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const roots = ["apps", "packages", "integrations"];
const providerNeutralSourceRoots = [
  "apps/tui/src",
  "packages/contracts/src",
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

// Every raw timer exception needs a reason here so new timeout plumbing stays intentional.
const setTimeoutAllowlist = new Map([
  [
    "apps/observer/src/runtime/main.ts",
    "One-tick deferral lets observer.stop flush its protocol response before shutdown closes the server.",
  ],
  [
    "apps/tui/src/state/store.ts",
    "Short reconnect backoff is the TUI observer-client subscription boundary, kept out of React presentation components.",
  ],
  [
    "apps/tui/src/state/operations/localOperationRunner.ts",
    "Short failed-create row expiry is local TUI operation feedback, isolated from observer command timeout plumbing.",
  ],
  [
    "apps/cli/src/commands/tui.ts",
    "Short popup-mode startup defer lets the TUI render a cached snapshot before requesting a nonblocking reconcile.",
  ],
  [
    "apps/observer/src/metadata/gitRefInvalidation.ts",
    "Short debounce coalesces noisy Git ref watch events before requesting an observer-owned metadata reconcile.",
  ],
  [
    "integrations/harness/opencode/src/pluginInstall.ts",
    "Generated OpenCode plugin uses a short socket send timeout because it runs inside OpenCode, outside WOSM runtime helpers.",
  ],
  [
    "apps/tui/src/widgets/useTopRowWidgets.ts",
    "Header widgets use a TUI-local minute-boundary timer for display text, not observer command timeout or retry plumbing.",
  ],
]);

const setIntervalAllowlist = new Map([
  [
    "apps/tui/src/widgets/useTopRowWidgets.ts",
    "Header widgets use local render refresh intervals for clock/weather text, isolated from observer runtime IO.",
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
      if (source.includes("setInterval(") && !setIntervalAllowlist.has(path)) {
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
    expect([...setIntervalAllowlist.values()].every((reason) => reason.length > 20)).toBe(true);
  });

  it("keeps tmux implementation details out of provider-neutral source packages", async () => {
    const files = (
      await Promise.all(
        providerNeutralSourceRoots.map((root) => sourceFilesAt(join(process.cwd(), root))),
      )
    )
      .flat()
      .filter(isProductionSourceFile);
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
  return files.filter((file) => isProductionSourceFile(file) && file.endsWith(".ts"));
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

function isProductionSourceFile(file: string): boolean {
  return (
    (file.endsWith(".ts") || file.endsWith(".tsx")) &&
    file.includes("/src/") &&
    !file.includes("/dist/") &&
    !file.endsWith(".d.ts") &&
    !file.endsWith(".test.ts") &&
    !file.endsWith(".test.tsx")
  );
}
