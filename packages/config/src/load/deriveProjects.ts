import { join } from "node:path";
import type { z } from "zod";
import { ConfigDefaultsSchema, ProjectDefaultsSchema } from "../schema.js";
import type { MutableRecord } from "./common.js";
import { isRecord } from "./common.js";
import { ConfigError, validationError } from "./errors.js";
import { resolveConfigPath } from "./paths.js";

type DeriveProjectOptions = { configPath: string; configDir: string; homeDir: string };

export function deriveProjectConfig(
  normalizedConfig: unknown,
  options: DeriveProjectOptions,
): unknown {
  if (!isRecord(normalizedConfig)) {
    throw new ConfigError({
      code: "CONFIG_VALIDATION_FAILED",
      message: "Wosm config is invalid: expected a TOML table.",
      configPath: options.configPath,
    });
  }

  const defaultsResult = ConfigDefaultsSchema.safeParse(normalizedConfig.defaults);
  if (!defaultsResult.success) {
    throw validationError(options.configPath, defaultsResult.error);
  }

  const rawProjects = normalizedConfig.projects;
  if (!Array.isArray(rawProjects)) {
    throw new ConfigError({
      code: "CONFIG_VALIDATION_FAILED",
      message: "Wosm config is invalid: projects must be an array.",
      configPath: options.configPath,
    });
  }

  const observer = isRecord(normalizedConfig.observer)
    ? expandObserverPaths(normalizedConfig.observer, options)
    : normalizedConfig.observer;
  const worktree = isRecord(normalizedConfig.worktree)
    ? expandWorktreePaths(normalizedConfig.worktree, options)
    : normalizedConfig.worktree;
  const globalWorktrunkManagedRoot = globalManagedRoot(worktree);

  return {
    ...normalizedConfig,
    observer,
    worktree,
    projects: rawProjects.map((project) =>
      deriveSingleProject(project, defaultsResult.data, globalWorktrunkManagedRoot, options),
    ),
  };
}

function deriveSingleProject(
  rawProject: unknown,
  globalDefaults: z.infer<typeof ConfigDefaultsSchema>,
  globalWorktrunkManagedRoot: string | undefined,
  options: DeriveProjectOptions,
): unknown {
  if (!isRecord(rawProject)) {
    return rawProject;
  }

  const projectId = typeof rawProject.id === "string" ? rawProject.id : undefined;
  const rawProjectDefaults = rawProject.defaults ?? {};
  const projectDefaultsResult = ProjectDefaultsSchema.partial().safeParse(rawProjectDefaults);

  if (!projectDefaultsResult.success) {
    throw validationError(options.configPath, projectDefaultsResult.error, projectId);
  }

  const resolvedRoot =
    typeof rawProject.root === "string"
      ? resolveConfigPath(rawProject.root, options.homeDir, options.configDir)
      : undefined;

  const derivedProject: MutableRecord = { ...rawProject };
  derivedProject.defaults = {
    harness: projectDefaultsResult.data.harness ?? globalDefaults.harness,
    terminal: projectDefaultsResult.data.terminal ?? globalDefaults.terminal,
    layout: projectDefaultsResult.data.layout ?? globalDefaults.layout,
  };
  derivedProject.worktrunk = deriveProjectWorktrunk(
    rawProject.worktrunk,
    resolvedRoot,
    projectId,
    globalWorktrunkManagedRoot,
    options,
  );

  if (resolvedRoot !== undefined) {
    derivedProject.root = resolvedRoot;
  }

  return derivedProject;
}

function deriveProjectWorktrunk(
  rawWorktrunk: unknown,
  projectRoot: string | undefined,
  projectId: string | undefined,
  globalWorktrunkManagedRoot: string | undefined,
  options: DeriveProjectOptions,
): unknown {
  if (rawWorktrunk !== undefined && !isRecord(rawWorktrunk)) {
    return rawWorktrunk;
  }

  const worktrunk: MutableRecord =
    rawWorktrunk === undefined ? { enabled: true } : { ...rawWorktrunk };

  if (typeof worktrunk.managedRoot === "string") {
    if (projectRoot !== undefined) {
      worktrunk.managedRoot = resolveConfigPath(
        worktrunk.managedRoot,
        options.homeDir,
        projectRoot,
      );
    }
    return worktrunk;
  }

  if (globalWorktrunkManagedRoot !== undefined && projectId !== undefined) {
    worktrunk.managedRoot = join(globalWorktrunkManagedRoot, projectManagedRootSegment(projectId));
  }

  return worktrunk;
}

function expandObserverPaths(
  observer: MutableRecord,
  options: { configDir: string; homeDir: string },
): MutableRecord {
  const expandedObserver = { ...observer };

  if (typeof observer.socketPath === "string") {
    expandedObserver.socketPath = resolveConfigPath(
      observer.socketPath,
      options.homeDir,
      options.configDir,
    );
  }

  if (typeof observer.stateDir === "string") {
    expandedObserver.stateDir = resolveConfigPath(
      observer.stateDir,
      options.homeDir,
      options.configDir,
    );
  }

  return expandedObserver;
}

function expandWorktreePaths(
  worktree: MutableRecord,
  options: { configDir: string; homeDir: string },
): MutableRecord {
  const worktrunk = isRecord(worktree.worktrunk)
    ? expandWorktrunkPaths(worktree.worktrunk, options)
    : worktree.worktrunk;

  return {
    ...worktree,
    ...(worktrunk === undefined ? {} : { worktrunk }),
  };
}

function expandWorktrunkPaths(
  worktrunk: MutableRecord,
  options: { configDir: string; homeDir: string },
): MutableRecord {
  const expandedWorktrunk = { ...worktrunk };

  if (typeof worktrunk.configPath === "string") {
    expandedWorktrunk.configPath = resolveConfigPath(
      worktrunk.configPath,
      options.homeDir,
      options.configDir,
    );
  }

  if (typeof worktrunk.managedRoot === "string") {
    expandedWorktrunk.managedRoot = resolveConfigPath(
      worktrunk.managedRoot,
      options.homeDir,
      options.configDir,
    );
  }

  return expandedWorktrunk;
}

function globalManagedRoot(worktree: unknown): string | undefined {
  if (!isRecord(worktree) || !isRecord(worktree.worktrunk)) {
    return undefined;
  }

  return typeof worktree.worktrunk.managedRoot === "string"
    ? worktree.worktrunk.managedRoot
    : undefined;
}

function projectManagedRootSegment(projectId: string): string {
  return projectId.replaceAll(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "project";
}
