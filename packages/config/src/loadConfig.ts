import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "smol-toml";
import type { z } from "zod";
import {
  ConfigDefaultsSchema,
  type ProjectConfig,
  ProjectDefaultsSchema,
  type ProjectLocalConfig,
  ProjectLocalConfigSchema,
  type WosmConfig,
  WosmConfigSchema,
} from "./schema";

export const DEFAULT_CONFIG_PATH = "~/.config/wosm/config.toml";

export type ConfigErrorCode =
  | "CONFIG_FILE_NOT_FOUND"
  | "CONFIG_FILE_READ_FAILED"
  | "CONFIG_TOML_PARSE_FAILED"
  | "CONFIG_VALIDATION_FAILED"
  | "CONFIG_DUPLICATE_PROJECT_ID"
  | "CONFIG_DUPLICATE_ALIAS"
  | "CONFIG_ALIAS_PROJECT_ID_COLLISION"
  | "CONFIG_INVALID_PROJECT_ROOT";

export type ConfigDiagnosticCode =
  | "CONFIG_LOCAL_CONFIG_NOT_FOUND"
  | "CONFIG_LOCAL_CONFIG_READ_FAILED"
  | "CONFIG_LOCAL_CONFIG_PARSE_FAILED"
  | "CONFIG_LOCAL_CONFIG_INVALID"
  | "CONFIG_LOCAL_COMMAND_OVERRIDE";

export interface ConfigErrorOptions {
  code: ConfigErrorCode;
  message: string;
  configPath: string;
  projectId?: string;
  cause?: unknown;
}

export class ConfigError extends Error {
  readonly tag = "ConfigError" as const;
  readonly code: ConfigErrorCode;
  readonly configPath: string;
  readonly projectId?: string;

  constructor(options: ConfigErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = this.tag;
    this.code = options.code;
    this.configPath = options.configPath;

    if (options.projectId !== undefined) {
      this.projectId = options.projectId;
    }
  }

  toSafeError(): SafeError {
    const safeError: SafeError = {
      tag: this.tag,
      code: this.code,
      message: this.message,
    };

    if (this.projectId !== undefined) {
      safeError.projectId = this.projectId;
    }

    return safeError;
  }
}

export interface ConfigDiagnostic {
  tag: "ConfigDiagnostic";
  code: ConfigDiagnosticCode;
  message: string;
  severity: "warn" | "error";
  configPath: string;
  projectId?: string;
}

export interface LoadedWosmConfig {
  configPath: string;
  config: WosmConfig;
  projects: ProjectConfig[];
  diagnostics: ConfigDiagnostic[];
}

export interface LoadConfigOptions {
  configPath?: string;
  homeDir?: string;
}

export interface LoadConfigFromTomlOptions extends LoadConfigOptions {}

type MutableRecord = Record<string, unknown>;
type KeyMap = Record<string, string>;
type ChildNormalizers = Record<string, (value: unknown) => unknown>;
type SafeError = {
  tag: string;
  code: string;
  message: string;
  projectId?: string;
};

export async function loadConfig(configPath: string): Promise<LoadedWosmConfig>;
export async function loadConfig(options?: LoadConfigOptions): Promise<LoadedWosmConfig>;
export async function loadConfig(
  input: string | LoadConfigOptions = {},
): Promise<LoadedWosmConfig> {
  const options = typeof input === "string" ? { configPath: input } : input;
  const home = options.homeDir ?? homedir();
  const configPath = normalizeConfigPath(options.configPath ?? DEFAULT_CONFIG_PATH, home);

  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch (cause) {
    throw new ConfigError({
      code:
        isNodeError(cause) && cause.code === "ENOENT"
          ? "CONFIG_FILE_NOT_FOUND"
          : "CONFIG_FILE_READ_FAILED",
      message:
        isNodeError(cause) && cause.code === "ENOENT"
          ? "Wosm config file was not found."
          : "Wosm config file could not be read.",
      configPath,
      cause,
    });
  }

  return loadConfigFromToml(source, { configPath, homeDir: home });
}

export async function loadConfigFromToml(
  source: string,
  options: LoadConfigFromTomlOptions = {},
): Promise<LoadedWosmConfig> {
  const home = options.homeDir ?? homedir();
  const configPath = normalizeConfigPath(options.configPath ?? DEFAULT_CONFIG_PATH, home);
  const configDir = dirname(configPath);
  const rawConfig = parseGlobalConfig(source, configPath);
  const normalizedConfig = normalizeGlobalConfig(rawConfig);
  const derivedConfig = deriveProjectConfig(normalizedConfig, {
    configPath,
    configDir,
    homeDir: home,
  });
  const parsedConfig = parseWosmConfig(derivedConfig, configPath);

  validateProjectIdentifiers(parsedConfig.projects, configPath);
  await validateProjectRoots(parsedConfig.projects, configPath);

  const configWithResolvedLocalPaths = {
    ...parsedConfig,
    projects: parsedConfig.projects.map((project) => resolveProjectLocalConfigPath(project, home)),
  };
  const localConfigResult = await applyProjectLocalConfigs(configWithResolvedLocalPaths, home);
  const config = parseWosmConfig(localConfigResult.config, configPath);

  return {
    configPath,
    config,
    projects: config.projects,
    diagnostics: localConfigResult.diagnostics,
  };
}

function parseGlobalConfig(source: string, configPath: string): unknown {
  try {
    return parse(source);
  } catch (cause) {
    throw new ConfigError({
      code: "CONFIG_TOML_PARSE_FAILED",
      message: "Wosm config file is not valid TOML.",
      configPath,
      cause,
    });
  }
}

function parseWosmConfig(value: unknown, configPath: string): WosmConfig {
  const result = WosmConfigSchema.safeParse(value);

  if (!result.success) {
    throw validationError(configPath, result.error);
  }

  return result.data;
}

function validationError(configPath: string, error: z.ZodError, projectId?: string): ConfigError {
  const options: ConfigErrorOptions = {
    code: "CONFIG_VALIDATION_FAILED",
    message: `Wosm config is invalid: ${formatZodError(error)}.`,
    configPath,
    cause: error,
  };

  if (projectId !== undefined) {
    options.projectId = projectId;
  }

  return new ConfigError({
    ...options,
  });
}

function deriveProjectConfig(
  normalizedConfig: unknown,
  options: { configPath: string; configDir: string; homeDir: string },
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

  return {
    ...normalizedConfig,
    observer,
    projects: rawProjects.map((project) =>
      deriveSingleProject(project, defaultsResult.data, options),
    ),
  };
}

function deriveSingleProject(
  rawProject: unknown,
  globalDefaults: z.infer<typeof ConfigDefaultsSchema>,
  options: { configPath: string; configDir: string; homeDir: string },
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

  const derivedProject: MutableRecord = {
    ...rawProject,
    defaults: {
      harness: projectDefaultsResult.data.harness ?? globalDefaults.harness,
      terminal: projectDefaultsResult.data.terminal ?? globalDefaults.terminal,
      layout: projectDefaultsResult.data.layout ?? globalDefaults.layout,
    },
    worktrunk: rawProject.worktrunk ?? { enabled: true },
  };

  if (typeof rawProject.root === "string") {
    derivedProject.root = resolveConfigPath(rawProject.root, options.homeDir, options.configDir);
  }

  return derivedProject;
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

function normalizeConfigPath(configPath: string, homeDir: string): string {
  return resolveConfigPath(configPath, homeDir, process.cwd());
}

function resolveConfigPath(input: string, homeDir: string, baseDir: string): string {
  const expanded = expandLeadingHome(input, homeDir);

  if (isAbsolute(expanded)) {
    return resolve(expanded);
  }

  return resolve(baseDir, expanded);
}

function expandLeadingHome(input: string, homeDir: string): string {
  if (input === "~") {
    return homeDir;
  }

  if (input.startsWith("~/")) {
    return join(homeDir, input.slice(2));
  }

  return input;
}

function resolveProjectLocalConfigPath(project: ProjectConfig, homeDir: string): ProjectConfig {
  if (project.localConfig === undefined) {
    return project;
  }

  const path = project.localConfig.path.startsWith("~/")
    ? resolveConfigPath(project.localConfig.path, homeDir, project.root)
    : resolve(project.root, project.localConfig.path);

  return {
    ...project,
    localConfig: {
      ...project.localConfig,
      path,
    },
  };
}

async function validateProjectRoots(
  projects: readonly ProjectConfig[],
  configPath: string,
): Promise<void> {
  for (const project of projects) {
    try {
      const rootStat = await stat(project.root);
      if (!rootStat.isDirectory()) {
        throw new ConfigError({
          code: "CONFIG_INVALID_PROJECT_ROOT",
          message: `Project "${project.id}" root must be an existing directory.`,
          configPath,
          projectId: project.id,
        });
      }
    } catch (cause) {
      if (cause instanceof ConfigError) {
        throw cause;
      }

      throw new ConfigError({
        code: "CONFIG_INVALID_PROJECT_ROOT",
        message: `Project "${project.id}" root must be an existing directory.`,
        configPath,
        projectId: project.id,
        cause,
      });
    }
  }
}

function validateProjectIdentifiers(projects: readonly ProjectConfig[], configPath: string): void {
  const projectIds = new Set<string>();

  for (const project of projects) {
    if (projectIds.has(project.id)) {
      throw new ConfigError({
        code: "CONFIG_DUPLICATE_PROJECT_ID",
        message: `Project ID "${project.id}" is defined more than once.`,
        configPath,
        projectId: project.id,
      });
    }

    projectIds.add(project.id);
  }

  const aliases = new Map<string, string>();

  for (const project of projects) {
    for (const alias of project.aliases ?? []) {
      if (projectIds.has(alias)) {
        throw new ConfigError({
          code: "CONFIG_ALIAS_PROJECT_ID_COLLISION",
          message: `Project alias "${alias}" collides with a project ID.`,
          configPath,
          projectId: project.id,
        });
      }

      const previousProjectId = aliases.get(alias);
      if (previousProjectId !== undefined) {
        throw new ConfigError({
          code: "CONFIG_DUPLICATE_ALIAS",
          message: `Project alias "${alias}" is used by both "${previousProjectId}" and "${project.id}".`,
          configPath,
          projectId: project.id,
        });
      }

      aliases.set(alias, project.id);
    }
  }
}

async function applyProjectLocalConfigs(
  config: WosmConfig,
  homeDir: string,
): Promise<{ config: WosmConfig; diagnostics: ConfigDiagnostic[] }> {
  const diagnostics: ConfigDiagnostic[] = [];
  const projects: ProjectConfig[] = [];

  for (const project of config.projects) {
    if (project.localConfig?.enabled !== true) {
      projects.push(project);
      continue;
    }

    const localConfigPath = project.localConfig.path;
    const localSource = await readProjectLocalConfig(localConfigPath, project, diagnostics);

    if (localSource === undefined) {
      projects.push(project);
      continue;
    }

    const localConfig = parseProjectLocalConfig(localSource, localConfigPath, project, diagnostics);

    if (localConfig === undefined) {
      projects.push(project);
      continue;
    }

    projects.push(mergeProjectLocalConfig(project, localConfig, localConfigPath, diagnostics));
  }

  return {
    config: {
      ...config,
      projects: projects.map((project) => resolveProjectLocalConfigPath(project, homeDir)),
    },
    diagnostics,
  };
}

async function readProjectLocalConfig(
  localConfigPath: string,
  project: ProjectConfig,
  diagnostics: ConfigDiagnostic[],
): Promise<string | undefined> {
  try {
    return await readFile(localConfigPath, "utf8");
  } catch (cause) {
    diagnostics.push(
      configDiagnostic({
        code:
          isNodeError(cause) && cause.code === "ENOENT"
            ? "CONFIG_LOCAL_CONFIG_NOT_FOUND"
            : "CONFIG_LOCAL_CONFIG_READ_FAILED",
        message:
          isNodeError(cause) && cause.code === "ENOENT"
            ? `Project "${project.id}" local config was not found.`
            : `Project "${project.id}" local config could not be read.`,
        configPath: localConfigPath,
        projectId: project.id,
      }),
    );
    return undefined;
  }
}

function parseProjectLocalConfig(
  source: string,
  localConfigPath: string,
  project: ProjectConfig,
  diagnostics: ConfigDiagnostic[],
): ProjectLocalConfig | undefined {
  let rawLocalConfig: unknown;

  try {
    rawLocalConfig = parse(source);
  } catch {
    diagnostics.push(
      configDiagnostic({
        code: "CONFIG_LOCAL_CONFIG_PARSE_FAILED",
        message: `Project "${project.id}" local config is not valid TOML.`,
        configPath: localConfigPath,
        projectId: project.id,
      }),
    );
    return undefined;
  }

  const result = ProjectLocalConfigSchema.safeParse(normalizeProjectLocalConfig(rawLocalConfig));

  if (!result.success) {
    diagnostics.push(
      configDiagnostic({
        code: "CONFIG_LOCAL_CONFIG_INVALID",
        message: `Project "${project.id}" local config contains unsupported or invalid fields.`,
        configPath: localConfigPath,
        projectId: project.id,
      }),
    );
    return undefined;
  }

  return result.data;
}

function mergeProjectLocalConfig(
  project: ProjectConfig,
  localConfig: ProjectLocalConfig,
  localConfigPath: string,
  diagnostics: ConfigDiagnostic[],
): ProjectConfig {
  const commands = mergeProjectLocalCommands(project, localConfig, localConfigPath, diagnostics);
  const defaults = mergeProjectLocalDefaults(project, localConfig);
  const display =
    localConfig.display === undefined
      ? project.display
      : {
          ...project.display,
          ...localConfig.display,
        };

  return {
    ...project,
    defaults,
    ...(commands === undefined ? {} : { commands }),
    ...(display === undefined ? {} : { display }),
  };
}

function mergeProjectLocalDefaults(
  project: ProjectConfig,
  localConfig: ProjectLocalConfig,
): ProjectConfig["defaults"] {
  return {
    ...project.defaults,
    ...(localConfig.defaults?.harness === undefined
      ? {}
      : { harness: localConfig.defaults.harness }),
    ...(localConfig.defaults?.layout === undefined ? {} : { layout: localConfig.defaults.layout }),
  };
}

function mergeProjectLocalCommands(
  project: ProjectConfig,
  localConfig: ProjectLocalConfig,
  localConfigPath: string,
  diagnostics: ConfigDiagnostic[],
): Record<string, string> | undefined {
  const projectCommands = project.commands ?? {};
  const localCommands = localConfig.commands ?? {};
  const mergedCommands = { ...projectCommands };

  for (const [commandLabel, command] of Object.entries(localCommands)) {
    if (Object.hasOwn(projectCommands, commandLabel)) {
      diagnostics.push(
        configDiagnostic({
          code: "CONFIG_LOCAL_COMMAND_OVERRIDE",
          message: `Project "${project.id}" local config cannot override command "${commandLabel}".`,
          configPath: localConfigPath,
          projectId: project.id,
        }),
      );
      continue;
    }

    mergedCommands[commandLabel] = command;
  }

  return Object.keys(mergedCommands).length > 0 ? mergedCommands : undefined;
}

function normalizeGlobalConfig(value: unknown): unknown {
  return normalizeObject(
    value,
    {
      schema_version: "schemaVersion",
    },
    {
      observer: normalizeObserverConfig,
      defaults: normalizeGlobalDefaults,
      worktree: normalizeWorktreeProvidersConfig,
      terminal: normalizeTerminalProvidersConfig,
      harness: normalizeHarnessProvidersConfig,
      projects: normalizeProjects,
    },
  );
}

function normalizeObserverConfig(value: unknown): unknown {
  return normalizeObject(value, {
    auto_start: "autoStart",
    auto_start_from_hooks: "autoStartFromHooks",
    idle_shutdown_minutes: "idleShutdownMinutes",
    reconcile_interval_ms: "reconcileIntervalMs",
    socket_path: "socketPath",
    state_dir: "stateDir",
  });
}

function normalizeGlobalDefaults(value: unknown): unknown {
  return normalizeObject(value, {
    worktree_provider: "worktreeProvider",
  });
}

function normalizeWorktreeProvidersConfig(value: unknown): unknown {
  return normalizeObject(value, {}, { worktrunk: normalizeWorktreeWorktrunkConfig });
}

function normalizeWorktreeWorktrunkConfig(value: unknown): unknown {
  return normalizeObject(value, {
    use_lifecycle_hooks: "useLifecycleHooks",
    hook_mode: "hookMode",
    breadcrumb_location: "breadcrumbLocation",
  });
}

function normalizeTerminalProvidersConfig(value: unknown): unknown {
  return normalizeObject(value, {}, { tmux: normalizeTmuxConfig });
}

function normalizeTmuxConfig(value: unknown): unknown {
  return normalizeObject(value, {
    session_prefix: "sessionPrefix",
    workbench_session: "workbenchSession",
    window_naming: "windowNaming",
    primary_agent_pane: "primaryAgentPane",
    popup_width: "popupWidth",
    popup_height: "popupHeight",
    popup_position: "popupPosition",
  });
}

function normalizeHarnessProvidersConfig(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([providerId, providerConfig]) => [
      providerId,
      normalizeHarnessProviderConfig(providerConfig),
    ]),
  );
}

function normalizeHarnessProviderConfig(value: unknown): unknown {
  return normalizeObject(value, {
    sandbox_mode: "sandboxMode",
    approval_policy: "approvalPolicy",
    install_hooks: "installHooks",
  });
}

function normalizeProjects(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map(normalizeProjectConfig);
}

function normalizeProjectConfig(value: unknown): unknown {
  return normalizeObject(
    value,
    {
      default_branch: "defaultBranch",
      local_config: "localConfig",
    },
    {
      defaults: normalizeProjectDefaults,
      worktrunk: normalizeProjectWorktrunkConfig,
      commands: preserveRecordKeys,
      env: preserveRecordKeys,
      display: normalizeDisplayConfig,
      localConfig: normalizeProjectLocalConfigRef,
      recoveryBreadcrumbs: normalizeProjectRecoveryBreadcrumbsConfig,
    },
  );
}

function normalizeProjectDefaults(value: unknown): unknown {
  return normalizeObject(value);
}

function normalizeProjectWorktrunkConfig(value: unknown): unknown {
  return normalizeObject(value);
}

function normalizeDisplayConfig(value: unknown): unknown {
  return normalizeObject(value, {
    sort_order: "sortOrder",
  });
}

function normalizeProjectLocalConfigRef(value: unknown): unknown {
  return normalizeObject(value);
}

function normalizeProjectRecoveryBreadcrumbsConfig(value: unknown): unknown {
  return normalizeObject(value);
}

function normalizeProjectLocalConfig(value: unknown): unknown {
  return normalizeObject(
    value,
    {
      schema_version: "schemaVersion",
    },
    {
      defaults: normalizeProjectDefaults,
      commands: preserveRecordKeys,
      display: normalizeDisplayConfig,
    },
  );
}

function normalizeObject(
  value: unknown,
  keyMap: KeyMap = {},
  childNormalizers: ChildNormalizers = {},
): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: MutableRecord = {};

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = keyMap[key] ?? snakeToCamel(key);
    const childNormalizer = childNormalizers[normalizedKey];
    normalized[normalizedKey] =
      childNormalizer === undefined ? childValue : childNormalizer(childValue);
  }

  return normalized;
}

function preserveRecordKeys(value: unknown): unknown {
  return value;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function configDiagnostic(options: {
  code: ConfigDiagnosticCode;
  message: string;
  configPath: string;
  projectId: string;
}): ConfigDiagnostic {
  return {
    tag: "ConfigDiagnostic",
    code: options.code,
    message: options.message,
    severity: "error",
    configPath: options.configPath,
    projectId: options.projectId,
  };
}

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];

  if (issue === undefined) {
    return "schema validation failed";
  }

  const path = issue.path.join(".");

  return path.length > 0 ? `${path} ${issue.message}` : issue.message;
}

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && "code" in error;
}
