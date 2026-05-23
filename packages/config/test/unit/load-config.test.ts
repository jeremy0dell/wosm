import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig, loadConfigFromToml } from "@wosm/config";
import { SafeErrorSchema } from "@wosm/contracts";
import { describe, expect, it } from "vitest";

const quoteTomlString = (value: string) => JSON.stringify(value);

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "wosm-config-"));
}

async function makeProjectRoot(parent: string, name: string): Promise<string> {
  const root = join(parent, name);
  await mkdir(root, { recursive: true });
  return root;
}

function baseToml(projectsToml: string): string {
  return `
schema_version = 1

[observer]
socket_path = "~/.local/state/wosm/observer.sock"
state_dir = "~/.local/state/wosm"

[defaults]
worktree_provider = "worktrunk"
terminal = "tmux"
harness = "codex"
layout = "agent-build-shell"

${projectsToml}
`;
}

function projectToml(
  id: string,
  root: string,
  options: {
    aliases?: string[];
    defaults?: string;
    localConfig?: string;
    commands?: string;
    recoveryBreadcrumbs?: string;
    label?: string;
    worktrunk?: string;
  } = {},
): string {
  const aliases =
    options.aliases === undefined
      ? ""
      : `aliases = [${options.aliases.map(quoteTomlString).join(", ")}]\n`;

  return `
[[projects]]
id = ${quoteTomlString(id)}
label = ${quoteTomlString(options.label ?? id)}
${aliases}root = ${quoteTomlString(root)}
repo = "github.com/example/${id}"
default_branch = "main"

[projects.worktrunk]
enabled = true
base = "main"
${options.worktrunk ?? ""}

${options.defaults ?? ""}
${options.commands ?? ""}
${options.localConfig ?? ""}
${options.recoveryBreadcrumbs ?? ""}
`;
}

async function writeProjectLocalConfig(root: string, contents: string): Promise<void> {
  const localDir = join(root, ".wosm");
  await mkdir(localDir, { recursive: true });
  await writeFile(join(localDir, "config.toml"), contents, "utf8");
}

describe("Phase 2 config loading", () => {
  it("loads TOML, applies defaults, expands paths, and keeps every configured project", async () => {
    const tempDir = await makeTempDir();
    const roots = {
      web: await makeProjectRoot(tempDir, "web"),
      api: await makeProjectRoot(tempDir, "api"),
      mobile: await makeProjectRoot(tempDir, "mobile"),
      wosm: await makeProjectRoot(tempDir, "wosm"),
    };
    const configPath = join(tempDir, "config.toml");
    const toml = baseToml(`
${projectToml("web", roots.web, { aliases: ["frontend", "site"] })}
${projectToml("api", roots.api, {
  aliases: ["backend"],
  defaults: `
[projects.defaults]
harness = "opencode"
layout = "agent-shell"
`,
})}
${projectToml("mobile", roots.mobile)}
${projectToml("wosm", roots.wosm)}
`);
    await writeFile(configPath, toml, "utf8");

    const loaded = await loadConfig({ configPath, homeDir: tempDir });

    expect(loaded.configPath).toBe(configPath);
    expect(loaded.projects.map((project) => project.id)).toEqual(["web", "api", "mobile", "wosm"]);
    expect(loaded.config.projects).toHaveLength(4);
    expect(loaded.config.projects[0]?.root).toBe(roots.web);
    expect(loaded.config.observer?.socketPath).toBe(
      join(tempDir, ".local/state/wosm/observer.sock"),
    );
    expect(loaded.config.observer?.stateDir).toBe(join(tempDir, ".local/state/wosm"));
    expect(loaded.config.projects.find((project) => project.id === "web")?.defaults).toEqual({
      harness: "codex",
      terminal: "tmux",
      layout: "agent-build-shell",
    });
    expect(loaded.config.projects.find((project) => project.id === "api")?.defaults).toEqual({
      harness: "opencode",
      terminal: "tmux",
      layout: "agent-shell",
    });
    expect(loaded.diagnostics).toEqual([]);
  });

  it("normalizes managed Worktrunk root policy for a project", async () => {
    const tempDir = await makeTempDir();
    const root = await makeProjectRoot(tempDir, "web");

    const loaded = await loadConfigFromToml(
      baseToml(
        projectToml("web", root, {
          worktrunk: `
managed_root = ".worktrees"
include_main = false
include_external = false
`,
        }),
      ),
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.config.projects[0]?.worktrunk).toEqual({
      enabled: true,
      base: "main",
      managedRoot: join(root, ".worktrees"),
      includeMain: false,
      includeExternal: false,
    });
  });

  it("derives project Worktrunk roots from a global managed root", async () => {
    const tempDir = await makeTempDir();
    const webRoot = await makeProjectRoot(tempDir, "web");
    const apiRoot = await makeProjectRoot(tempDir, "api-service");

    const loaded = await loadConfigFromToml(
      `
schema_version = 1

[defaults]
worktree_provider = "worktrunk"
terminal = "tmux"
harness = "codex"
layout = "agent-build-shell"

[worktree.worktrunk]
managed_root = "~/.worktrees"

${projectToml("web", webRoot, {
  worktrunk: `
include_main = false
include_external = false
`,
})}
${projectToml("api/service", apiRoot)}
`,
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.config.worktree?.worktrunk?.managedRoot).toBe(join(tempDir, ".worktrees"));
    expect(loaded.config.projects.find((project) => project.id === "web")?.worktrunk).toEqual({
      enabled: true,
      base: "main",
      managedRoot: join(tempDir, ".worktrees", "web"),
      includeMain: false,
      includeExternal: false,
    });
    expect(
      loaded.config.projects.find((project) => project.id === "api/service")?.worktrunk.managedRoot,
    ).toBe(join(tempDir, ".worktrees", "api_service"));
  });

  it("lets project Worktrunk roots override the global managed root", async () => {
    const tempDir = await makeTempDir();
    const webRoot = await makeProjectRoot(tempDir, "web");
    const apiRoot = await makeProjectRoot(tempDir, "api");

    const loaded = await loadConfigFromToml(
      `
schema_version = 1

[defaults]
worktree_provider = "worktrunk"
terminal = "tmux"
harness = "codex"
layout = "agent-build-shell"

[worktree.worktrunk]
managed_root = "~/.worktrees"

${projectToml("web", webRoot, {
  worktrunk: `
managed_root = "~/custom-web"
`,
})}
${projectToml("api", apiRoot, {
  worktrunk: `
managed_root = "/var/tmp/wosm-api"
`,
})}
`,
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.config.projects.find((project) => project.id === "web")?.worktrunk).toEqual({
      enabled: true,
      base: "main",
      managedRoot: join(tempDir, "custom-web"),
    });
    expect(loaded.config.projects.find((project) => project.id === "api")?.worktrunk).toEqual({
      enabled: true,
      base: "main",
      managedRoot: "/var/tmp/wosm-api",
    });
  });

  it("rejects duplicate effective Worktrunk managed roots", async () => {
    const tempDir = await makeTempDir();
    const apiSlashRoot = await makeProjectRoot(tempDir, "api-slash");
    const apiUnderscoreRoot = await makeProjectRoot(tempDir, "api-underscore");

    await expect(
      loadConfigFromToml(
        `
schema_version = 1

[defaults]
worktree_provider = "worktrunk"
terminal = "tmux"
harness = "codex"
layout = "agent-build-shell"

[worktree.worktrunk]
managed_root = "~/.worktrees"

${projectToml("api/service", apiSlashRoot)}
${projectToml("api_service", apiUnderscoreRoot)}
`,
        { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
      ),
    ).rejects.toMatchObject({
      tag: "ConfigError",
      code: "CONFIG_DUPLICATE_WORKTREE_MANAGED_ROOT",
      projectId: "api_service",
    });
  });

  it("rejects duplicate project IDs", async () => {
    const tempDir = await makeTempDir();
    const root = await makeProjectRoot(tempDir, "web");

    await expect(
      loadConfigFromToml(baseToml(`${projectToml("web", root)}${projectToml("web", root)}`), {
        configPath: join(tempDir, "config.toml"),
        homeDir: tempDir,
      }),
    ).rejects.toMatchObject({
      tag: "ConfigError",
      code: "CONFIG_DUPLICATE_PROJECT_ID",
      configPath: join(tempDir, "config.toml"),
      projectId: "web",
    });
  });

  it("rejects duplicate aliases", async () => {
    const tempDir = await makeTempDir();
    const webRoot = await makeProjectRoot(tempDir, "web");
    const apiRoot = await makeProjectRoot(tempDir, "api");

    await expect(
      loadConfigFromToml(
        baseToml(
          `${projectToml("web", webRoot, { aliases: ["site"] })}${projectToml("api", apiRoot, {
            aliases: ["site"],
          })}`,
        ),
        {
          configPath: join(tempDir, "config.toml"),
          homeDir: tempDir,
        },
      ),
    ).rejects.toMatchObject({
      tag: "ConfigError",
      code: "CONFIG_DUPLICATE_ALIAS",
      projectId: "api",
    });
  });

  it("rejects aliases that collide with project IDs", async () => {
    const tempDir = await makeTempDir();
    const webRoot = await makeProjectRoot(tempDir, "web");
    const apiRoot = await makeProjectRoot(tempDir, "api");

    await expect(
      loadConfigFromToml(
        baseToml(
          `${projectToml("web", webRoot)}${projectToml("api", apiRoot, { aliases: ["web"] })}`,
        ),
        {
          configPath: join(tempDir, "config.toml"),
          homeDir: tempDir,
        },
      ),
    ).rejects.toMatchObject({
      tag: "ConfigError",
      code: "CONFIG_ALIAS_PROJECT_ID_COLLISION",
      projectId: "api",
    });
  });

  it("rejects project roots that do not exist", async () => {
    const tempDir = await makeTempDir();
    const missingRoot = join(tempDir, "missing");

    await expect(
      loadConfigFromToml(baseToml(projectToml("web", missingRoot)), {
        configPath: join(tempDir, "config.toml"),
        homeDir: tempDir,
      }),
    ).rejects.toBeInstanceOf(ConfigError);
    await expect(
      loadConfigFromToml(baseToml(projectToml("web", missingRoot)), {
        configPath: join(tempDir, "config.toml"),
        homeDir: tempDir,
      }),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID_PROJECT_ROOT",
      projectId: "web",
    });
  });

  it("rejects missing required fields", async () => {
    const tempDir = await makeTempDir();

    await expect(
      loadConfigFromToml(
        baseToml(`
[[projects]]
id = "web"
label = "web"

[projects.worktrunk]
enabled = true
`),
        {
          configPath: join(tempDir, "config.toml"),
          homeDir: tempDir,
        },
      ),
    ).rejects.toMatchObject({
      tag: "ConfigError",
      code: "CONFIG_VALIDATION_FAILED",
    });
  });

  it("ignores project-local config unless explicitly enabled", async () => {
    const tempDir = await makeTempDir();
    const root = await makeProjectRoot(tempDir, "web");
    await writeProjectLocalConfig(
      root,
      `
schema_version = 1

[defaults]
harness = "opencode"
layout = "agent-shell"

[commands]
typecheck = "pnpm typecheck"
`,
    );

    const loaded = await loadConfigFromToml(
      baseToml(
        projectToml("web", root, {
          localConfig: `
[projects.local_config]
enabled = false
path = ".wosm/config.toml"
`,
        }),
      ),
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.projects[0]?.defaults.harness).toBe("codex");
    expect(loaded.projects[0]?.commands).toBeUndefined();
    expect(loaded.diagnostics).toEqual([]);
  });

  it("merges safe project-local defaults and additive commands when enabled", async () => {
    const tempDir = await makeTempDir();
    const root = await makeProjectRoot(tempDir, "web");
    await writeProjectLocalConfig(
      root,
      `
schema_version = 1

[defaults]
harness = "opencode"
layout = "agent-shell"

[commands]
test = "pnpm test"
typecheck = "pnpm typecheck"

[display]
group = "work"
sort_order = 10
`,
    );

    const loaded = await loadConfigFromToml(
      baseToml(
        projectToml("web", root, {
          commands: `
[projects.commands]
dev = "pnpm dev"
`,
          localConfig: `
[projects.local_config]
enabled = true
path = ".wosm/config.toml"
trust = "explicit"
`,
        }),
      ),
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.projects[0]?.defaults).toEqual({
      harness: "opencode",
      terminal: "tmux",
      layout: "agent-shell",
    });
    expect(loaded.projects[0]?.commands).toEqual({
      dev: "pnpm dev",
      test: "pnpm test",
      typecheck: "pnpm typecheck",
    });
    expect(loaded.projects[0]?.display).toEqual({
      group: "work",
      sortOrder: 10,
    });
    expect(loaded.diagnostics).toEqual([]);
  });

  it("rejects disallowed project-local authority without dropping the global project", async () => {
    const tempDir = await makeTempDir();
    const root = await makeProjectRoot(tempDir, "web");
    await writeProjectLocalConfig(
      root,
      `
schema_version = 1

[[projects]]
id = "shadow"
label = "shadow"
root = "/tmp/shadow"

[harness.codex]
approval_policy = "never"
`,
    );

    const loaded = await loadConfigFromToml(
      baseToml(
        projectToml("web", root, {
          localConfig: `
[projects.local_config]
enabled = true
path = ".wosm/config.toml"
trust = "explicit"
`,
        }),
      ),
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.projects.map((project) => project.id)).toEqual(["web"]);
    expect(loaded.projects[0]?.defaults.harness).toBe("codex");
    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0]).toMatchObject({
      code: "CONFIG_LOCAL_CONFIG_INVALID",
      projectId: "web",
    });
  });

  it("records invalid project-local config as a diagnostic instead of crashing the load", async () => {
    const tempDir = await makeTempDir();
    const root = await makeProjectRoot(tempDir, "web");
    await writeProjectLocalConfig(root, "schema_version = 1\n[commands\nbroken = true\n");

    const loaded = await loadConfigFromToml(
      baseToml(
        projectToml("web", root, {
          localConfig: `
[projects.local_config]
enabled = true
path = ".wosm/config.toml"
trust = "explicit"
`,
        }),
      ),
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.projects.map((project) => project.id)).toEqual(["web"]);
    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0]).toMatchObject({
      code: "CONFIG_LOCAL_CONFIG_PARSE_FAILED",
      projectId: "web",
    });
  });

  it("converts ConfigError to SafeError without stack traces or raw internals", () => {
    const error = new ConfigError({
      code: "CONFIG_VALIDATION_FAILED",
      message: "Config validation failed.",
      configPath: "/tmp/wosm/config.toml",
      projectId: "web",
      cause: new Error("secret stack detail"),
    });

    const safeError = error.toSafeError();

    expect(SafeErrorSchema.parse(safeError)).toEqual(safeError);
    expect(safeError).toEqual({
      tag: "ConfigError",
      code: "CONFIG_VALIDATION_FAILED",
      message: "Config validation failed.",
      projectId: "web",
    });
    expect(JSON.stringify(safeError)).not.toContain("stack");
    expect(JSON.stringify(safeError)).not.toContain("secret");
  });

  it("normalizes explicit global project recovery breadcrumb config", async () => {
    const tempDir = await makeTempDir();
    const root = await makeProjectRoot(tempDir, "web");

    const loaded = await loadConfigFromToml(
      baseToml(
        projectToml("web", root, {
          recoveryBreadcrumbs: `
[projects.recovery_breadcrumbs]
location = "worktree"
path = ".wosm/recovery.json"
`,
        }),
      ),
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.projects[0]?.recoveryBreadcrumbs).toEqual({
      location: "worktree",
      path: ".wosm/recovery.json",
    });
  });

  it("rejects project-local recovery breadcrumb authority", async () => {
    const tempDir = await makeTempDir();
    const root = await makeProjectRoot(tempDir, "web");
    await writeProjectLocalConfig(
      root,
      `
schema_version = 1

[recovery_breadcrumbs]
location = "worktree"
`,
    );

    const loaded = await loadConfigFromToml(
      baseToml(
        projectToml("web", root, {
          localConfig: `
[projects.local_config]
enabled = true
path = ".wosm/config.toml"
trust = "explicit"
`,
        }),
      ),
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.projects[0]?.recoveryBreadcrumbs).toBeUndefined();
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({
        code: "CONFIG_LOCAL_CONFIG_INVALID",
        projectId: "web",
      }),
    ]);
  });

  it("normalizes observability retention TOML keys", async () => {
    const tempDir = await makeTempDir();
    const loaded = await loadConfigFromToml(
      `
schema_version = 1
projects = []

[defaults]
worktree_provider = "worktrunk"
terminal = "tmux"
harness = "codex"
layout = "agent-build-shell"

[observability.retention]
max_days = 7
max_total_mb = 128
max_file_mb = 5
max_files_per_component = 3

[observability.retention.components]
observer_max_mb = 50
hook_runner_max_mb = 10

[observability.retention.sqlite]
events_max_days = 14

[observability.retention.debug_bundles]
max_bundles = 5

[observability.retention.hook_spool]
failed_max_items = 100
`,
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.config.observability?.retention).toMatchObject({
      maxDays: 7,
      maxTotalMb: 128,
      components: {
        observerMaxMb: 50,
        hookRunnerMaxMb: 10,
      },
      sqlite: {
        eventsMaxDays: 14,
      },
      debugBundles: {
        maxBundles: 5,
      },
      hookSpool: {
        failedMaxItems: 100,
      },
    });
  });

  it("normalizes and resolves Worktrunk user config path", async () => {
    const tempDir = await makeTempDir();

    const loaded = await loadConfigFromToml(
      `
schema_version = 1
projects = []

[defaults]
worktree_provider = "worktrunk"
terminal = "tmux"
harness = "codex"
layout = "agent-build-shell"

[worktree.worktrunk]
command = "wt"
config_path = "~/isolated-worktrunk/config.toml"
use_lifecycle_hooks = true
hook_mode = "required-for-mvp"
breadcrumb_location = "provider-native"
`,
      { configPath: join(tempDir, "config.toml"), homeDir: tempDir },
    );

    expect(loaded.config.worktree?.worktrunk).toEqual({
      command: "wt",
      configPath: join(tempDir, "isolated-worktrunk/config.toml"),
      useLifecycleHooks: true,
      hookMode: "required-for-mvp",
      breadcrumbLocation: "provider-native",
    });
  });
});
