import type { ExternalCommandRunner } from "@wosm/runtime";
import type { CliEnv } from "../../env.js";
import type { SetupApplyFileSystem } from "./apply.js";
import type { SetupFileSystemReader } from "./checks/config.js";

export type SetupPromptChoice = {
  value: string;
  label: string;
};

export type SetupPromptAdapter = {
  confirm(message: string): Promise<boolean>;
  select(message: string, choices: readonly SetupPromptChoice[]): Promise<string>;
};

export type SetupCommandDeps = {
  runner?: ExternalCommandRunner;
  prompt?: SetupPromptAdapter;
  fs?: SetupFileSystemReader & SetupApplyFileSystem;
  access?: (path: string) => Promise<void>;
  writeStdout?: (chunk: string) => void | Promise<void>;
  env?: CliEnv;
  cwd?: string;
  homeDir?: string;
  now?: () => Date;
};

export type SetupCommandOptions = {
  configPath?: string;
  env?: CliEnv;
};

export type SetupCommandResult = {
  code: number;
  output?: unknown;
};
