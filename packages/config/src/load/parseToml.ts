import { parse } from "smol-toml";
import type { WosmConfig } from "../schema";
import { WosmConfigSchema } from "../schema";
import { ConfigError, validationError } from "./errors";

export function parseGlobalConfig(source: string, configPath: string): unknown {
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

export function parseWosmConfig(value: unknown, configPath: string): WosmConfig {
  const result = WosmConfigSchema.safeParse(value);

  if (!result.success) {
    throw validationError(configPath, result.error);
  }

  return result.data;
}
