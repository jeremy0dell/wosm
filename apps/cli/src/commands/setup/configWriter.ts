import { basename } from "node:path";
import { loadConfigFromToml } from "@wosm/config";
import { pathIsSame, stableName } from "@wosm/runtime";
import { selectSetupHarness } from "./harnessSelection.js";
import type {
  ConfigWritePlan,
  SetupConfigFact,
  SetupFacts,
  SetupGitFact,
  SetupHarnessFact,
} from "./model.js";

export type PlanSetupConfigWriteOptions = {
  selectedHarness?: SetupHarnessFact;
};

export async function planSetupConfigWrite(
  facts: SetupFacts,
  options: PlanSetupConfigWriteOptions = {},
): Promise<ConfigWritePlan> {
  const selectedHarness =
    options.selectedHarness ?? selectSetupHarness(facts.harnesses, facts.selectedHarness);
  if (selectedHarness === undefined) {
    return {
      operation: "blocked",
      path: facts.configPath,
      reason: "No supported harness CLI is available; config was not planned.",
    };
  }
  if (facts.git.status !== "ok") {
    return {
      operation: "blocked",
      path: facts.configPath,
      reason: "No git repository was detected; config was not planned.",
    };
  }

  if (facts.config.status === "missing") {
    return {
      operation: "create",
      path: facts.configPath,
      content: renderNewSetupConfig(facts.git, selectedHarness),
    };
  }

  if (facts.config.status === "invalid") {
    return {
      operation: "blocked",
      path: facts.config.path,
      reason: facts.config.message,
    };
  }

  return planExistingConfigAppend(facts.config, facts.git, selectedHarness);
}

export function renderNewSetupConfig(
  git: Extract<SetupGitFact, { status: "ok" }>,
  harness: SetupHarnessFact,
): string {
  const projectId = projectIdForGit(git);
  const defaultBranch = git.defaultBranch;
  return [
    "schema_version = 1",
    "",
    "[observer]",
    'socket_path = "~/.local/state/wosm/observer.sock"',
    'state_dir = "~/.local/state/wosm"',
    "",
    "[defaults]",
    'worktree_provider = "worktrunk"',
    'terminal = "tmux"',
    `harness = ${tomlString(harness.id)}`,
    'layout = "agent-shell"',
    `default_branch = ${tomlString(defaultBranch)}`,
    "",
    "[worktree.worktrunk]",
    `command = ${tomlString("wt")}`,
    'managed_root = "~/.worktrees"',
    `base = ${tomlString(defaultBranch)}`,
    "include_main = false",
    "include_external = false",
    "use_lifecycle_hooks = false",
    'hook_mode = "disabled"',
    "",
    "[terminal.tmux]",
    'session_prefix = "wosm"',
    'topology = "workbench"',
    'workbench_session = "wosm"',
    'window_naming = "project-branch"',
    "primary_agent_pane = true",
    "",
    `[harness.${harness.id}]`,
    "enabled = true",
    `command = ${tomlString(harness.command)}`,
    "",
    "[[projects]]",
    `id = ${tomlString(projectId)}`,
    `label = ${tomlString(git.repoName)}`,
    `root = ${tomlString(git.root)}`,
    "",
  ].join("\n");
}

async function planExistingConfigAppend(
  config: Extract<SetupConfigFact, { status: "valid" }>,
  git: Extract<SetupGitFact, { status: "ok" }>,
  harness: SetupHarnessFact,
): Promise<ConfigWritePlan> {
  try {
    const loaded = await loadConfigFromToml(config.source, { configPath: config.path });
    const hasProjectForRoot = loaded.config.projects.some((project) =>
      pathIsSame(project.root, git.root),
    );
    const hasHarness = loaded.config.harness?.[harness.id] !== undefined;
    const appendedText = renderAppendText({
      git,
      harness,
      addProject: !hasProjectForRoot,
      addHarness: !hasHarness,
    });
    if (appendedText.length === 0) {
      return {
        operation: "none",
        reason: "Config already includes this repository and selected harness.",
      };
    }
    return {
      operation: "append",
      path: config.path,
      content: `${config.source.trimEnd()}\n${appendedText}`,
      appendedText,
    };
  } catch (error) {
    return {
      operation: "blocked",
      path: config.path,
      reason:
        error instanceof Error
          ? `WOSM config is not safe to update: ${error.message}`
          : "WOSM config is not safe to update.",
    };
  }
}

function renderAppendText(input: {
  git: Extract<SetupGitFact, { status: "ok" }>;
  harness: SetupHarnessFact;
  addProject: boolean;
  addHarness: boolean;
}): string {
  const blocks: string[] = [];
  if (input.addHarness) {
    blocks.push(
      [
        `[harness.${input.harness.id}]`,
        "enabled = true",
        `command = ${tomlString(input.harness.command)}`,
      ].join("\n"),
    );
  }
  if (input.addProject) {
    blocks.push(
      [
        "[[projects]]",
        `id = ${tomlString(projectIdForGit(input.git))}`,
        `label = ${tomlString(input.git.repoName)}`,
        `root = ${tomlString(input.git.root)}`,
      ].join("\n"),
    );
  }
  return blocks.length === 0 ? "" : `\n${blocks.join("\n\n")}\n`;
}

function projectIdForGit(git: Extract<SetupGitFact, { status: "ok" }>): string {
  return stableName({
    profile: "id",
    display: [basename(git.root) || git.repoName],
    unique: [git.root],
    maxLength: 64,
  });
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
