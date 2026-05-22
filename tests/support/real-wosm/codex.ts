import {
  access,
  appendFile,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { RealDogfoodEnvironment } from "./env";
import { requireToolPath } from "./env";
import { runWosmJson } from "./process";
import type { RealTempRepo } from "./repo";

export type CodexSentinel = {
  relativePath: string;
  absolutePath: string;
  token: string;
  prompt: string;
};

export type CodexHookFixture = {
  hookScriptPath: string;
  hookConfigPath: string;
  hookLogDirPath: string;
  hookPayloadLogPath: string;
  hookDeliveryLogPath: string;
  cleanup: () => Promise<void>;
};

export function createCodexSentinel(repo: RealTempRepo, label: string): CodexSentinel {
  const token = `wosm-real-${label}-${process.pid}-${Date.now()}`;
  const relativePath = `.wosm-dogfood/sentinels/${sanitize(label)}-${Date.now()}.txt`;
  const absolutePath = join(repo.repoPath, relativePath);
  return {
    relativePath,
    absolutePath,
    token,
    prompt: boundedCodexPrompt(relativePath, token),
  };
}

export async function waitForCodexSentinel(
  sentinel: CodexSentinel,
  options: number | { rootPath?: string; timeoutMs?: number } = 180_000,
): Promise<void> {
  const timeoutMs = typeof options === "number" ? options : (options.timeoutMs ?? 180_000);
  const absolutePath =
    typeof options === "number" || options.rootPath === undefined
      ? sentinel.absolutePath
      : join(options.rootPath, sentinel.relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const text = await readFile(absolutePath, "utf8").catch(() => "");
    if (text.includes(sentinel.token)) {
      return;
    }
    await delay(1000);
  }
  throw new Error(`Codex did not write sentinel ${sentinel.relativePath}.`);
}

export async function createCodexHookEnabledWrapper(input: {
  env: RealDogfoodEnvironment;
  repo: RealTempRepo;
}): Promise<string> {
  const wrapperPath = join(input.repo.root, "codex-with-wosm-hooks.sh");
  const codexHome = codexHomeForRepo(input.repo);
  const codexBin = requireToolPath(input.env, "codex");
  await mkdir(codexHome, { recursive: true });
  await linkCodexUserFile(codexHome, "auth.json");
  await ensureCodexConfigFile(codexHome);
  await writeFile(
    wrapperPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `export CODEX_HOME=${shellSingleQuote(codexHome)}`,
      `if [ "\${1-}" = "login" ]; then`,
      `  exec ${shellSingleQuote(codexBin)} "$@"`,
      "fi",
      `exec ${shellSingleQuote(codexBin)} '--dangerously-bypass-hook-trust' "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(wrapperPath, 0o700);
  return wrapperPath;
}

export async function installCodexHookProjectConfig(input: {
  env: RealDogfoodEnvironment;
  repo: RealTempRepo;
  configPath: string;
}): Promise<CodexHookFixture> {
  const codexHome = codexHomeForRepo(input.repo);
  const hookConfigPath = join(codexHome, "config.toml");
  const hookLogDirPath = join(
    tmpdir(),
    `wosm-real-codex-hooks-${process.pid}-${Date.now()}-${basename(input.repo.root)}`,
  );
  const hookScriptPath = join(hookLogDirPath, "wosm-codex-hook.sh");
  const hookPayloadLogPath = join(hookLogDirPath, "codex-hook-payloads.jsonl");
  const hookDeliveryLogPath = join(hookLogDirPath, "codex-hook-delivery.log");
  await mkdir(hookLogDirPath, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    hookScriptPath,
    codexHookScript({
      wosmBin: input.env.wosmBin,
      configPath: input.configPath,
      payloadLogPath: hookPayloadLogPath,
      deliveryLogPath: hookDeliveryLogPath,
    }),
    "utf8",
  );
  await chmod(hookScriptPath, 0o700);
  await appendFile(hookConfigPath, codexHookInlineToml(hookScriptPath), "utf8");
  return {
    hookScriptPath,
    hookConfigPath,
    hookLogDirPath,
    hookPayloadLogPath,
    hookDeliveryLogPath,
    cleanup: async () => {
      await rm(hookLogDirPath, { recursive: true, force: true });
    },
  };
}

export async function waitForFileContaining(
  filePath: string,
  text: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const content = await readFile(filePath, "utf8").catch(() => "");
    if (content.includes(text)) {
      return;
    }
    await delay(500);
  }
  throw new Error(`${filePath} did not contain ${text}.`);
}

export async function writeFailureBundle(input: {
  env: RealDogfoodEnvironment;
  configPath: string;
  commandId?: string;
}): Promise<unknown | undefined> {
  const args = ["debug", "bundle"];
  if (input.commandId !== undefined) {
    args.push("--command", input.commandId);
  }
  return runWosmJson(input.env, {
    configPath: input.configPath,
    args,
    timeoutMs: 30_000,
  }).catch(() => undefined);
}

function boundedCodexPrompt(relativePath: string, token: string): string {
  return [
    "This is a wosm real dogfood sentinel task.",
    `Create or overwrite only ${relativePath}.`,
    `Write exactly this token followed by a newline: ${token}`,
    "Do not modify any other files.",
  ].join("\n");
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
}

function codexHookScript(input: {
  wosmBin: string;
  configPath: string;
  payloadLogPath: string;
  deliveryLogPath: string;
}): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'payload_file="$(mktemp /tmp/wosm-codex-hook.XXXXXX)"',
    "trap 'rm -f \"$payload_file\"' EXIT",
    'cat > "$payload_file"',
    `cat "$payload_file" >> ${shellSingleQuote(input.payloadLogPath)}`,
    `printf '\\n' >> ${shellSingleQuote(input.payloadLogPath)}`,
    'event="$(/usr/bin/env node -e \'const fs = require("node:fs"); const input = fs.readFileSync(process.argv[1], "utf8"); const payload = JSON.parse(input); if (typeof payload.hook_event_name !== "string" || payload.hook_event_name.length === 0) { throw new Error("missing hook_event_name"); } process.stdout.write(payload.hook_event_name);\' "$payload_file")"',
    `${shellSingleQuote(input.wosmBin)} --config ${shellSingleQuote(input.configPath)} hook codex "$event" < "$payload_file" >> ${shellSingleQuote(input.deliveryLogPath)} 2>&1`,
    "",
  ].join("\n");
}

function codexHookInlineToml(command: string): string {
  return ["", "# wosm real dogfood hook fixture", ...codexHookConfigArgs(command), ""].join("\n");
}

function codexHookConfigArgs(command: string): string[] {
  return [
    hookConfigToml("SessionStart", command, "startup|resume|clear"),
    hookConfigToml("UserPromptSubmit", command),
    hookConfigToml("PreToolUse", command, ".*"),
    hookConfigToml("PermissionRequest", command, ".*"),
    hookConfigToml("PostToolUse", command, ".*"),
    hookConfigToml("Stop", command),
  ];
}

function hookConfigToml(event: string, command: string, matcher?: string): string {
  const lines = [`[[hooks.${event}]]`];
  if (matcher !== undefined) {
    lines.push(`matcher = ${tomlString(matcher)}`);
  }
  lines.push(
    `[[hooks.${event}.hooks]]`,
    'type = "command"',
    `command = ${tomlString(command)}`,
    "timeout = 30",
    `statusMessage = ${tomlString("Notify wosm")}`,
    "",
  );
  return lines.join("\n");
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexHomeForRepo(repo: RealTempRepo): string {
  return join(repo.root, "codex-home");
}

async function linkCodexUserFile(codexHome: string, fileName: string): Promise<void> {
  const source = join(homedir(), ".codex", fileName);
  try {
    await access(source);
  } catch {
    return;
  }
  try {
    await symlink(source, join(codexHome, fileName));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      return;
    }
    throw error;
  }
}

async function ensureCodexConfigFile(codexHome: string): Promise<void> {
  const copied = await copyCodexUserFile(codexHome, "config.toml");
  if (!copied) {
    await writeFile(join(codexHome, "config.toml"), "[features]\nhooks = true\n", "utf8");
  }
}

async function copyCodexUserFile(codexHome: string, fileName: string): Promise<boolean> {
  const source = join(homedir(), ".codex", fileName);
  try {
    await access(source);
  } catch {
    return false;
  }
  await copyFile(source, join(codexHome, fileName));
  return true;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
