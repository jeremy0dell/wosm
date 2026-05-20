import { readFile } from "node:fs/promises";
import {
  ParsedWosmConfigSchema,
  ProjectConfigSchema,
  ProjectLocalConfigSchema,
  WosmConfigSchema,
} from "@wosm/config";
import { describe, expect, it } from "vitest";

const fixtureUrl = (path: string) => new URL(`../fixtures/${path}`, import.meta.url);

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(fixtureUrl(path), "utf8"));
}

describe("Phase 1 config schemas", () => {
  it("validates parsed config objects without loading TOML or expanding paths", async () => {
    const config = await loadJson("valid-config.json");
    const parsed = ParsedWosmConfigSchema.parse(config);

    expect(WosmConfigSchema.parse(config)).toEqual(parsed);
    expect(parsed.projects).toHaveLength(2);
    expect(parsed.projects[0]?.root).toBe("~/projects/web");
    expect(parsed.projects[0]?.localConfig).toEqual({
      enabled: true,
      path: ".wosm/config.toml",
      trust: "explicit",
    });
    expect(parsed.projects[0]?.recoveryBreadcrumbs).toEqual({
      location: "external",
    });
  });

  it("exports ProjectConfig as a focused project-level schema", async () => {
    const config = ParsedWosmConfigSchema.parse(await loadJson("valid-config.json"));

    for (const project of config.projects) {
      expect(ProjectConfigSchema.parse(project)).toEqual(project);
    }
  });

  it("validates project-local config supplements without adding projects", async () => {
    const projectLocalConfig = ProjectLocalConfigSchema.parse(
      await loadJson("project-local-config.json"),
    );

    expect(projectLocalConfig.defaults?.harness).toBe("codex");
    expect(projectLocalConfig.commands?.typecheck).toBe("pnpm typecheck");
    expect("projects" in projectLocalConfig).toBe(false);
  });

  it("rejects invalid parsed config objects", async () => {
    expect(ParsedWosmConfigSchema.safeParse(await loadJson("invalid-config.json")).success).toBe(
      false,
    );
    expect(
      ProjectLocalConfigSchema.safeParse({
        schemaVersion: 1,
        projects: [{ id: "web" }],
      }).success,
    ).toBe(false);
  });

  it("validates explicit project recovery breadcrumb opt-in", () => {
    const project = ProjectConfigSchema.parse({
      id: "web",
      label: "web",
      root: "/tmp/web",
      defaults: {
        harness: "codex",
        terminal: "tmux",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
      },
      recoveryBreadcrumbs: {
        location: "worktree",
        path: ".wosm/recovery.json",
      },
    });

    expect(project.recoveryBreadcrumbs).toEqual({
      location: "worktree",
      path: ".wosm/recovery.json",
    });
    expect(
      ProjectConfigSchema.safeParse({
        ...project,
        recoveryBreadcrumbs: {
          location: "shell",
        },
      }).success,
    ).toBe(false);
    expect(
      ProjectConfigSchema.safeParse({
        ...project,
        recoveryBreadcrumbs: {
          location: "worktree",
          path: "",
        },
      }).success,
    ).toBe(false);
  });
});
