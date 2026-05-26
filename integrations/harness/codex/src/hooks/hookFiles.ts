import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CodexHookSetupError } from "./hookErrors.js";

export async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "ENOENT") {
      return "";
    }
    throw new CodexHookSetupError(
      "CODEX_HOOK_CONFIG_UNREADABLE",
      "Codex hook config could not be read.",
      { cause },
    );
  }
}

export async function writeHookConfig(path: string, contents: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, contents, { mode: 0o600 });
  } catch (cause) {
    throw new CodexHookSetupError(
      "CODEX_HOOK_WRITE_FAILED",
      "Codex hook config could not be written.",
      { cause },
    );
  }
}

export async function writeHookScript(path: string, contents: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, contents, { mode: 0o700 });
    await chmod(path, 0o700);
  } catch (cause) {
    throw new CodexHookSetupError(
      "CODEX_HOOK_WRITE_FAILED",
      "Codex hook script could not be written.",
      { cause },
    );
  }
}

export async function removeHookScriptIfPresent(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "ENOENT") {
      return false;
    }
    throw new CodexHookSetupError(
      "CODEX_HOOK_WRITE_FAILED",
      "Codex hook script could not be removed.",
      { cause },
    );
  }
}

export async function backupIfPresent(path: string): Promise<string | undefined> {
  try {
    await stat(path);
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "ENOENT") {
      return undefined;
    }
    throw new CodexHookSetupError(
      "CODEX_HOOK_CONFIG_UNREADABLE",
      "Codex hook config metadata could not be read.",
      { cause },
    );
  }
  const backupPath = `${path}.bak.${new Date().toISOString().replaceAll(/[^0-9]/g, "")}`;
  try {
    await copyFile(path, backupPath);
  } catch (cause) {
    throw new CodexHookSetupError(
      "CODEX_HOOK_WRITE_FAILED",
      "Codex hook config backup could not be written.",
      { cause },
    );
  }
  return backupPath;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
