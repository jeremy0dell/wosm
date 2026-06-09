import { homedir } from "node:os";
import type { ExternalCommandRunner } from "@wosm/runtime";
import type { CliEnv } from "../../../env.js";
import type { SetupFacts, SetupMode } from "../model.js";
import { checkBrewDependency } from "./brew.js";
import {
  type CheckSetupConfigOptions,
  checkSetupConfig,
  type SetupFileSystemReader,
  setupConfigPath,
} from "./config.js";
import { setupEnv } from "./env.js";
import { type CheckGitOptions, checkSetupGit } from "./git.js";
import { type CheckHarnessesOptions, checkSetupHarnesses } from "./harnesses.js";
import { checkSetupTmux } from "./tmux.js";
import { checkSetupTmuxBinding } from "./tmuxBinding.js";
import { checkSetupWorktrunk } from "./worktrunk.js";

export type SetupDependencyCheckOptions = {
  runner?: ExternalCommandRunner;
  env?: CliEnv;
  access?: (path: string) => Promise<void>;
};

export type CollectSetupFactsOptions = {
  mode: SetupMode;
  configPath?: string;
  cwd?: string;
  homeDir?: string;
  env?: CliEnv;
  runner?: ExternalCommandRunner;
  access?: (path: string) => Promise<void>;
  fs?: SetupFileSystemReader;
  now?: () => Date;
  noBrew?: boolean;
};

export async function collectSetupFacts(options: CollectSetupFactsOptions): Promise<SetupFacts> {
  const env = setupEnv(options.env);
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? env.HOME ?? homedir();
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const commandInput: {
    runner?: ExternalCommandRunner;
    env: CliEnv;
    cwd: string;
    homeDir: string;
  } = { env, cwd, homeDir };
  if (options.runner !== undefined) commandInput.runner = options.runner;
  const commandOptions = commandCheckOptions(commandInput);
  const dependencyInput: {
    runner?: ExternalCommandRunner;
    env: CliEnv;
    access?: (path: string) => Promise<void>;
  } = { env };
  if (options.runner !== undefined) dependencyInput.runner = options.runner;
  if (options.access !== undefined) dependencyInput.access = options.access;
  const dependencyOptions = dependencyCheckOptions(dependencyInput);
  const git = await checkSetupGit(commandOptions);
  const gitRoot = git.status === "ok" ? git.root : undefined;
  const setupConfigInput: {
    options: CollectSetupFactsOptions;
    cwd: string;
    env: CliEnv;
    gitRoot?: string;
  } = { options, cwd, env };
  if (gitRoot !== undefined) setupConfigInput.gitRoot = gitRoot;
  const configPathOptions = setupConfigOptions(setupConfigInput);
  const configPath = setupConfigPath(configPathOptions);
  const [worktrunk, tmux, brew, harnesses, config, tmuxBinding] = await Promise.all([
    checkSetupWorktrunk(dependencyOptions),
    checkSetupTmux(dependencyOptions),
    checkBrewDependency({
      ...commandOptions,
      ...(options.noBrew === undefined ? {} : { noBrew: options.noBrew }),
    }),
    checkSetupHarnesses(commandOptions),
    checkSetupConfig({ ...configPathOptions, configPath }),
    checkSetupTmuxBinding({
      homeDir,
      ...(options.fs === undefined ? {} : { fs: options.fs }),
    }),
  ]);

  return {
    generatedAt,
    mode: options.mode,
    configPath,
    homeDir,
    worktrunk,
    tmux,
    brew,
    git,
    harnesses,
    config,
    tmuxBinding,
  };
}

function setupConfigOptions(input: {
  options: CollectSetupFactsOptions;
  cwd: string;
  env: CliEnv;
  gitRoot?: string;
}): CheckSetupConfigOptions {
  const options: CheckSetupConfigOptions = {
    cwd: input.cwd,
    env: input.env,
  };
  if (input.options.configPath !== undefined) options.configPath = input.options.configPath;
  if (input.options.homeDir !== undefined) options.homeDir = input.options.homeDir;
  if (input.gitRoot !== undefined) options.gitRoot = input.gitRoot;
  if (input.options.fs !== undefined) options.fs = input.options.fs;
  return options;
}

function commandCheckOptions(input: {
  runner?: ExternalCommandRunner;
  env: CliEnv;
  cwd: string;
  homeDir?: string;
}): CheckGitOptions & CheckHarnessesOptions {
  const options: CheckGitOptions & CheckHarnessesOptions = {
    env: input.env,
    cwd: input.cwd,
  };
  if (input.runner !== undefined) options.runner = input.runner;
  if (input.homeDir !== undefined) options.homeDir = input.homeDir;
  return options;
}

function dependencyCheckOptions(input: {
  runner?: ExternalCommandRunner;
  env: CliEnv;
  access?: (path: string) => Promise<void>;
}): SetupDependencyCheckOptions {
  const options: SetupDependencyCheckOptions = {
    env: input.env,
  };
  if (input.runner !== undefined) options.runner = input.runner;
  if (input.access !== undefined) options.access = input.access;
  return options;
}
