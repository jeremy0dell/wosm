import { applySetupPlan } from "./apply.js";
import { checkBrewDependency } from "./checks/brew.js";
import { checkSetupTmux } from "./checks/tmux.js";
import { checkSetupToolchain, type ToolchainFact } from "./checks/toolchain.js";
import { checkSetupWorktrunk } from "./checks/worktrunk.js";
import { applyOptions, dependencyOptionsForCommand } from "./flowUtils.js";
import { write } from "./io.js";
import type { SetupAction, SetupPlan } from "./model.js";
import type { SetupCommandDeps, SetupCommandOptions, SetupCommandResult } from "./types.js";

export async function runSetupSystemCommand(
  args: { check: boolean; yes: boolean; noBrew: boolean },
  options: SetupCommandOptions,
  deps: SetupCommandDeps,
): Promise<SetupCommandResult> {
  const env = deps.env ?? options.env;
  const dependencyOptions = dependencyOptionsForCommand(deps, env);
  const [worktrunk, tmux, brew, toolchain] = await Promise.all([
    checkSetupWorktrunk(dependencyOptions),
    checkSetupTmux(dependencyOptions),
    checkBrewDependency({
      ...(deps.runner === undefined ? {} : { runner: deps.runner }),
      ...(env === undefined ? {} : { env }),
      ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
      noBrew: args.noBrew,
    }),
    checkSetupToolchain({
      ...(deps.runner === undefined ? {} : { runner: deps.runner }),
      ...(env === undefined ? {} : { env }),
      ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
    }),
  ]);
  const systemReady =
    worktrunk.status === "ok" &&
    tmux.status === "ok" &&
    toolchain.node.status === "ok" &&
    toolchain.pnpm.status === "ok";
  const lines = [
    "wosm setup system",
    "",
    `  ${worktrunk.status === "ok" ? "ok" : "missing"} Worktrunk / wt`,
    `  ${tmux.status === "ok" ? "ok" : "missing"} tmux`,
    `  ${brew.status === "ok" ? "ok" : brew.status} Homebrew`,
    `  ${toolchainStatusLabel(toolchain.node)} Node.js ${toolchainVersionLabel(toolchain.node)}`,
    `  ${toolchainStatusLabel(toolchain.pnpm)} pnpm ${toolchainVersionLabel(toolchain.pnpm)}`,
    "",
  ];
  const toolchainHints = runtimeToolchainHints(toolchain);
  if (toolchainHints.length > 0) {
    lines.push("Development runtime:", ...toolchainHints, "");
  }

  if (args.yes && brew.status === "ok") {
    const actions: SetupAction[] = [];
    if (worktrunk.status === "missing") actions.push(systemInstallAction("worktrunk"));
    if (tmux.status === "missing") actions.push(systemInstallAction("tmux"));
    const result = await applySetupPlan(
      systemPlan(actions),
      applyOptions(deps, { announceActions: true, showCommandOutput: true }),
    );
    if (result.failedAction !== undefined) {
      lines.push("Install failed. Run: wosm setup system --check", "");
      await write(deps, lines.join("\n"));
      return { code: 1 };
    }
  }

  await write(deps, lines.join("\n"));
  return { code: systemReady ? 0 : 1 };
}

function systemInstallAction(formula: "worktrunk" | "tmux"): SetupAction {
  return {
    id: `install-${formula}`,
    kind: "brew-install",
    tier: "required",
    selected: true,
    label: `Install ${formula}`,
    message: `Install ${formula} with Homebrew.`,
    command: ["brew", "install", formula],
    data: { formula },
  };
}

function systemPlan(actions: SetupAction[]): SetupPlan {
  return {
    generatedAt: new Date().toISOString(),
    mode: "apply",
    checks: [],
    actions,
    summary: {
      requiredOk: true,
      requiredMissing: 0,
      warnings: 0,
      selectedActions: actions.length,
      configPath: "",
    },
    nextSteps: [],
  };
}

function toolchainStatusLabel(fact: ToolchainFact): string {
  return fact.status === "ok" ? "ok" : fact.status;
}

function toolchainVersionLabel(fact: ToolchainFact): string {
  const actual = fact.actual ?? "not found";
  return `${actual} (expected ${fact.expected})`;
}

function runtimeToolchainHints(toolchain: { node: ToolchainFact; pnpm: ToolchainFact }): string[] {
  const hints: string[] = [];
  if (toolchain.node.status !== "ok") {
    hints.push(
      "  Use your Node version manager to install and select Node.js 24.x, for example:",
      "    fnm install 24 && fnm use 24",
      "    nvm install 24 && nvm use 24",
    );
  }
  if (toolchain.pnpm.status !== "ok") {
    hints.push(
      "  After Node.js 24 is active, enable the repo-pinned package manager with:",
      "    corepack enable",
      "    corepack prepare pnpm@11.0.0 --activate",
    );
  }
  if (hints.length > 0) {
    hints.push("  WOSM setup does not change Node or pnpm automatically.");
  }
  return hints;
}
