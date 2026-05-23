import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Phase 18 release readiness docs", () => {
  it("documents install, smoke, known issues, release notes, and deterministic versus real gates", async () => {
    const [
      readme,
      docsReadme,
      install,
      knownIssues,
      releaseNotes,
      releaseReadiness,
      dogfoodChecklist,
      manualSmoke,
      systemDependencies,
      testsReadme,
      dogfoodConfig,
    ] = await Promise.all([
      read("README.md"),
      read("docs/README.md"),
      read("docs/install.md"),
      read("docs/known-issues.md"),
      read("docs/release-notes/phase-18-dogfood-milestone.md"),
      read("docs/release-readiness.md"),
      read("docs/dogfood-checklist.md"),
      read("docs/manual-smoke.md"),
      read("docs/system-dependencies.md"),
      read("tests/README.md"),
      read("examples/dogfood-config.toml"),
    ]);

    expect(readme).toContain("pnpm smoke:release");
    expect(readme).toContain("docs/install.md");
    expect(docsReadme).toContain("install.md");
    expect(install).toContain("Node.js 24.x");
    expect(install).toContain("pnpm smoke:release");
    expect(install).toContain("examples/dogfood-config.toml");
    expect(knownIssues).toContain("Real E2E remains opt-in");
    expect(releaseNotes).toContain("Phase 18 dogfood milestone");
    expect(releaseNotes).toContain("No public npm package");
    expect(releaseReadiness).toContain("pnpm smoke:release");
    expect(releaseReadiness).toContain("Deterministic Gate");
    expect(releaseReadiness).toContain("Real Dogfood Gate");
    expect(dogfoodChecklist).toContain("examples/dogfood-config.toml");
    expect(manualSmoke).toContain("pnpm smoke:release");
    expect(systemDependencies).toContain("tmux");
    expect(systemDependencies).toContain("pnpm setup:system:check");
    expect(testsReadme).toContain("release-hardening-smoke");
    expect(dogfoodConfig).toContain('managed_root = "~/.worktrees"');
    expect(dogfoodConfig).toContain("include_external = false");
    expect(dogfoodConfig).not.toContain('profile = "default"');
  });
});

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}
