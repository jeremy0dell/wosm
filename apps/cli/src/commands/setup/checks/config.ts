import { DEFAULT_CONFIG_PATH, loadConfigFromToml } from "@wosm/config";
import { pathIsSame, resolveLocalPath } from "@wosm/runtime";
import type { CliEnv } from "../../../env.js";
import type { SetupConfigFact } from "../model.js";

export type SetupFileSystemReader = {
  readFile(path: string): Promise<string>;
};

export type CheckSetupConfigOptions = {
  configPath?: string;
  cwd?: string;
  homeDir?: string;
  gitRoot?: string;
  fs?: SetupFileSystemReader;
  env?: CliEnv;
};

export async function checkSetupConfig(
  options: CheckSetupConfigOptions = {},
): Promise<SetupConfigFact> {
  const path = setupConfigPath(options);
  const fs = options.fs ?? nodeFsReader();
  let source: string;
  try {
    source = await fs.readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        status: "missing",
        path,
        message: `WOSM config does not exist yet at ${path}.`,
      };
    }
    return {
      status: "invalid",
      path,
      source: "",
      message: `WOSM config could not be read at ${path}.`,
    };
  }

  try {
    const loaded = await loadConfigFromToml(source, {
      configPath: path,
      homeDir: setupHomeDir(options),
    });
    const gitRoot = options.gitRoot;
    return {
      status: "valid",
      path,
      source,
      hasProjectForRoot:
        gitRoot !== undefined &&
        loaded.config.projects.some((project) => pathIsSame(project.root, gitRoot)),
      configuredHarnesses: Object.keys(loaded.config.harness ?? {}),
    };
  } catch (error) {
    return {
      status: "invalid",
      path,
      source,
      message:
        error instanceof Error
          ? `WOSM config is not safe to update: ${error.message}`
          : "WOSM config is not safe to update.",
    };
  }
}

export function setupConfigPath(options: CheckSetupConfigOptions = {}): string {
  return resolveLocalPath(
    options.configPath ?? DEFAULT_CONFIG_PATH,
    setupHomeDir(options),
    options.cwd,
  );
}

function setupHomeDir(options: CheckSetupConfigOptions): string {
  return options.homeDir ?? options.env?.HOME ?? process.env.HOME ?? process.cwd();
}

function nodeFsReader(): SetupFileSystemReader {
  return {
    async readFile(path) {
      const { readFile } = await import("node:fs/promises");
      return readFile(path, "utf8");
    },
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
