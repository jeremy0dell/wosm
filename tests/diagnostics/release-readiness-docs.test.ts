import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("release readiness docs", () => {
  it("documents install, smoke, known issues, local use, and deterministic versus real gates", async () => {
    const [
      readme,
      docsReadme,
      install,
      knownIssues,
      releaseReadiness,
      localUseChecklist,
      manualSmoke,
      systemDependencies,
      testsReadme,
      localRealConfig,
    ] = await Promise.all([
      read("README.md"),
      read("docs/README.md"),
      read("docs/install.md"),
      read("docs/known-issues.md"),
      read("docs/release-readiness.md"),
      read("docs/local-use-checklist.md"),
      read("docs/manual-smoke.md"),
      read("docs/system-dependencies.md"),
      read("tests/README.md"),
      read("examples/local-real-config.toml"),
    ]);

    expect(readme).toContain("pnpm smoke:release");
    expect(readme).toContain("docs/install.md");
    expect(docsReadme).toContain("install.md");
    expect(install).toContain("Node.js 24.x");
    expect(install).toContain("pnpm smoke:release");
    expect(install).toContain("examples/local-real-config.toml");
    expect(knownIssues).toContain("Real E2E remains opt-in");
    expect(releaseReadiness).toContain("standard-ci");
    expect(releaseReadiness).toContain("pnpm smoke:release");
    expect(releaseReadiness).toContain("Standard CI Gate");
    expect(releaseReadiness).toContain("Manual Release Gate");
    expect(releaseReadiness).toContain("Real E2E Gate");
    expect(localUseChecklist).toContain("examples/local-real-config.toml");
    expect(manualSmoke).toContain("pnpm smoke:release");
    expect(systemDependencies).toContain("tmux");
    expect(systemDependencies).toContain("pnpm setup:system:check");
    expect(testsReadme).toContain("release-hardening-smoke");
    expect(localRealConfig).toContain('managed_root = "~/.worktrees"');
    expect(localRealConfig).toContain("include_external = false");
    expect(localRealConfig).not.toContain('profile = "default"');
  });
});

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}
