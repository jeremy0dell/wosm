import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@wosm/cli";
import type { DoctorReport } from "@wosm/contracts";
import { afterEach, describe, expect, it } from "vitest";

describe("Phase 18 CLI release doctor", () => {
  const configPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      configPaths
        .splice(0)
        .map((configPath) =>
          runCli(["--config", configPath, "observer", "stop"]).catch(() => undefined),
        ),
    );
  });

  it("reports project-local config diagnostics, missing Worktrunk, hooks, SQLite, and bundle availability", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-release-doctor-cli-"));
    const configPath = await writeReleaseDoctorConfig(root);
    configPaths.push(configPath);

    const result = await runCli(["--config", configPath, "doctor"]);
    const report = result.output as DoctorReport;

    expect(result.code).toBe(0);
    expect(report.status).toBe("degraded");
    expect(report.config.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONFIG_LOCAL_CONFIG_PARSE_FAILED",
          projectId: "release-web",
        }),
      ]),
    );
    expect(report.providers.worktrunk).toMatchObject({
      status: "unavailable",
      lastError: {
        code: "WORKTRUNK_UNAVAILABLE",
      },
    });
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "sqlite",
          status: "ok",
        }),
        expect.objectContaining({
          name: "worktrunk-hooks",
          status: "warn",
          error: expect.objectContaining({
            code: "WORKTRUNK_HOOKS_MISSING",
          }),
        }),
      ]),
    );
    expect(report.debugBundle.available).toBe(true);
    expect(report.debugBundle.diagnosticsDir).toContain("diagnostics");
  }, 60_000);
});

async function writeReleaseDoctorConfig(root: string): Promise<string> {
  const projectRoot = join(root, "release-web");
  const localConfigDir = join(projectRoot, ".wosm");
  const stateDir = join(root, "state");
  const configPath = join(root, "config.toml");
  await mkdir(localConfigDir, { recursive: true });
  await mkdir(join(root, "worktrunk"), { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(localConfigDir, "config.toml"), "schema_version = 1\n[commands\n");
  await writeFile(
    configPath,
    [
      "schema_version = 1",
      "",
      "[observer]",
      `socket_path = ${JSON.stringify(join(root, "run", "observer.sock"))}`,
      `state_dir = ${JSON.stringify(stateDir)}`,
      "",
      "[defaults]",
      'worktree_provider = "worktrunk"',
      'terminal = "noop-terminal"',
      'harness = "noop-harness"',
      'layout = "agent-shell"',
      "",
      "[worktree.worktrunk]",
      'command = "missing-wt-release-doctor"',
      `config_path = ${JSON.stringify(join(root, "worktrunk", "config.toml"))}`,
      "use_lifecycle_hooks = true",
      'hook_mode = "required-for-mvp"',
      "",
      "[[projects]]",
      'id = "release-web"',
      'label = "Release Web"',
      `root = ${JSON.stringify(projectRoot)}`,
      'default_branch = "main"',
      "",
      "[projects.defaults]",
      'harness = "noop-harness"',
      'terminal = "noop-terminal"',
      'layout = "agent-shell"',
      "",
      "[projects.worktrunk]",
      "enabled = true",
      'base = "main"',
      'managed_root = ".worktrees"',
      "include_main = false",
      "include_external = false",
      "",
      "[projects.local_config]",
      "enabled = true",
      'path = ".wosm/config.toml"',
      'trust = "explicit"',
      "",
    ].join("\n"),
  );
  return configPath;
}
