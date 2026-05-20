import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { isNodeError } from "./common";
import { deriveProjectConfig } from "./deriveProjects";
import type { LoadConfigFromTomlOptions, LoadConfigOptions, LoadedWosmConfig } from "./errors";
import { ConfigError } from "./errors";
import { applyProjectLocalConfigs } from "./localConfig";
import { normalizeGlobalConfig } from "./normalize";
import { parseGlobalConfig, parseWosmConfig } from "./parseToml";
import { DEFAULT_CONFIG_PATH, normalizeConfigPath, resolveProjectLocalConfigPath } from "./paths";
import { validateProjectIdentifiers, validateProjectRoots } from "./validate";

export type {
  ConfigDiagnostic,
  ConfigDiagnosticCode,
  ConfigErrorCode,
  ConfigErrorOptions,
  LoadConfigFromTomlOptions,
  LoadConfigOptions,
  LoadedWosmConfig,
} from "./errors";
export { ConfigError } from "./errors";
export { DEFAULT_CONFIG_PATH } from "./paths";

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
