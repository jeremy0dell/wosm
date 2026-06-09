import { applySetupPlan } from "./apply.js";
import { checkBrewDependency } from "./checks/brew.js";
import { checkSetupTmux } from "./checks/tmux.js";
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
  const [worktrunk, tmux, brew] = await Promise.all([
    checkSetupWorktrunk(dependencyOptions),
    checkSetupTmux(dependencyOptions),
    checkBrewDependency({
      ...(deps.runner === undefined ? {} : { runner: deps.runner }),
      ...(env === undefined ? {} : { env }),
      ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
      noBrew: args.noBrew,
    }),
  ]);
  const lines = [
    "wosm setup system",
    "",
    `  ${worktrunk.status === "ok" ? "ok" : "missing"} Worktrunk / wt`,
    `  ${tmux.status === "ok" ? "ok" : "missing"} tmux`,
    `  ${brew.status === "ok" ? "ok" : brew.status} Homebrew`,
    "",
  ];

  if (args.yes && brew.status === "ok") {
    const actions: SetupAction[] = [];
    if (worktrunk.status === "missing") actions.push(systemInstallAction("worktrunk"));
    if (tmux.status === "missing") actions.push(systemInstallAction("tmux"));
    const result = await applySetupPlan(systemPlan(actions), applyOptions(deps, {}));
    if (result.failedAction !== undefined) {
      lines.push("Install failed. Run: wosm setup system --check", "");
      await write(deps, lines.join("\n"));
      return { code: 1 };
    }
  }

  await write(deps, lines.join("\n"));
  return { code: worktrunk.status === "ok" && tmux.status === "ok" ? 0 : 1 };
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
