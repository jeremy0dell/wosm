import { createInterface } from "node:readline/promises";
import type { ExternalCommandRunner } from "@wosm/runtime";
import type { CliEnv } from "../../env.js";
import { applySetupPlan, type SetupApplyFileSystem } from "./apply.js";
import { parseSetupArgs, setupUsage } from "./args.js";
import type { SetupFileSystemReader } from "./checks/config.js";
import {
  type CollectSetupFactsOptions,
  checkBrewDependency,
  collectSetupFacts,
} from "./checks/system.js";
import { checkSetupTmux } from "./checks/tmux.js";
import { checkSetupWorktrunk } from "./checks/worktrunk.js";
import { planSetupConfigWrite } from "./configWriter.js";
import type { SetupAction, SetupFacts, SetupPlan, SupportedHarnessId } from "./model.js";
import { buildSetupPlan } from "./planner.js";
import { renderSetupApplyResult, renderSetupPlan } from "./render.js";

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

export async function runSetupCommand(
  argv: readonly string[],
  options: SetupCommandOptions = {},
  deps: SetupCommandDeps = {},
): Promise<SetupCommandResult> {
  let args: ReturnType<typeof parseSetupArgs>;
  try {
    args = parseSetupArgs(argv);
  } catch (error) {
    await write(
      deps,
      `${error instanceof Error ? error.message : String(error)}\n\n${setupUsage()}`,
    );
    return { code: 2 };
  }

  if (args.help) {
    await write(deps, setupUsage());
    return { code: 0 };
  }

  if (args.kind === "system") {
    return runSetupSystemCommand(args, options, deps);
  }

  if (args.kind === "check") {
    const facts = await collectForCommand("check", options, deps, { noBrew: args.noBrew });
    const plan = buildSetupPlan(facts);
    if (args.json) return { code: plan.summary.requiredOk ? 0 : 1, output: plan };
    await write(deps, renderSetupPlan(plan));
    return { code: plan.summary.requiredOk ? 0 : 1 };
  }

  if (args.kind === "plan") {
    const facts = await collectForCommand("plan", options, deps, { noBrew: args.noBrew });
    const configWrite = await planSetupConfigWrite(facts);
    const plan = buildSetupPlan(facts, { configWrite });
    if (args.json) return { code: 0, output: plan };
    await write(deps, renderSetupPlan(plan));
    return { code: 0 };
  }

  if (args.kind === "apply") {
    return runNonInteractiveApply(options, deps, { dryRun: args.dryRun, noBrew: args.noBrew });
  }

  return runGuidedSetup(options, deps);
}

async function runNonInteractiveApply(
  options: SetupCommandOptions,
  deps: SetupCommandDeps,
  flags: { dryRun: boolean; noBrew: boolean },
): Promise<SetupCommandResult> {
  const initialFacts = await collectForCommand("apply", options, deps, { noBrew: flags.noBrew });
  const initialConfigWrite = await planSetupConfigWrite(initialFacts);
  const initialPlan = buildSetupPlan(initialFacts, { configWrite: initialConfigWrite });

  if (flags.dryRun) {
    const dryRun = await applySetupPlan(initialPlan, applyOptions(deps, { dryRun: true }));
    await write(deps, renderSetupPlan(dryRun.plan));
    return { code: 0 };
  }

  const installResult = await applySetupPlan(
    initialPlan,
    applyOptions(deps, { actionFilter: isInstallAction }),
  );
  if (installResult.failedAction !== undefined) {
    await write(deps, renderSetupApplyResult(markRequiredIncomplete(installResult.plan)));
    return { code: 1 };
  }

  const refreshedFacts = await collectForCommand("apply", options, deps, { noBrew: flags.noBrew });
  const configWrite = await planSetupConfigWrite(refreshedFacts);
  const refreshedPlan = buildSetupPlan(refreshedFacts, { configWrite });
  if (!coreReadyForConfigWrite(refreshedPlan)) {
    await write(deps, renderSetupApplyResult(refreshedPlan));
    return { code: 1 };
  }

  const writeResult = await applySetupPlan(
    refreshedPlan,
    applyOptions(deps, { actionFilter: isConfigAction }),
  );
  const outputPlan =
    writeResult.failedAction === undefined
      ? { ...writeResult.plan, summary: { ...writeResult.plan.summary, requiredOk: true } }
      : writeResult.plan;
  await write(deps, renderSetupApplyResult(outputPlan));
  return { code: writeResult.failedAction === undefined ? 0 : 1 };
}

async function runGuidedSetup(
  options: SetupCommandOptions,
  deps: SetupCommandDeps,
): Promise<SetupCommandResult> {
  const prompt = deps.prompt ?? defaultPrompt();
  await write(deps, "Core setup: Worktrunk + tmux + one agent + first project.\n\n");
  let facts = await collectForCommand("apply", options, deps, {});
  let plan = buildSetupPlan(facts, { configWrite: await planSetupConfigWrite(facts) });
  await write(deps, renderSetupPlan(plan));

  const installActions = plan.actions.filter(isInstallAction).filter((action) => action.selected);
  if (installActions.length > 0) {
    const accepted = await prompt.confirm("Install missing required tools?");
    if (!accepted) {
      await write(deps, "No changes made.\n");
      return { code: 1 };
    }
    const installResult = await applySetupPlan(
      plan,
      applyOptions(deps, { actionFilter: isInstallAction }),
    );
    if (installResult.failedAction !== undefined) {
      await write(deps, renderSetupApplyResult(markRequiredIncomplete(installResult.plan)));
      return { code: 1 };
    }
    facts = await collectForCommand("apply", options, deps, {});
  }

  const availableHarnesses = facts.harnesses.filter((harness) => harness.status === "ok");
  if (availableHarnesses.length === 0) {
    const noHarnessPlan = buildSetupPlan(facts);
    await write(deps, renderSetupApplyResult(noHarnessPlan));
    return { code: 1 };
  }
  if (availableHarnesses.length > 1) {
    const selected = await prompt.select(
      "Select the agent CLI to enable.",
      availableHarnesses.map((harness) => ({ value: harness.id, label: harness.label })),
    );
    if (isSupportedHarnessId(selected)) {
      facts = { ...facts, selectedHarness: selected };
    }
  }

  const configWrite = await planSetupConfigWrite(facts);
  plan = buildSetupPlan(facts, { configWrite });
  if (!coreReadyForConfigWrite(plan)) {
    await write(deps, renderSetupApplyResult(plan));
    return { code: 1 };
  }

  const configActions = plan.actions.filter(isConfigAction).filter((action) => action.selected);
  if (configActions.length > 0) {
    const accepted = await prompt.confirm("Write WOSM project config?");
    if (!accepted) {
      await write(deps, "Config was not written.\n");
      return { code: 1 };
    }
    const writeResult = await applySetupPlan(
      plan,
      applyOptions(deps, { actionFilter: isConfigAction }),
    );
    if (writeResult.failedAction !== undefined) {
      await write(deps, "Config write failed. Run: wosm setup plan\n");
      return { code: 1 };
    }
  }

  const shellIntegration = plan.actions.find(
    (action) => action.id === "worktrunk-shell-integration",
  );
  if (shellIntegration !== undefined) {
    const accepted = await prompt.confirm("Install Worktrunk shell integration?");
    if (accepted) {
      await applySetupPlan(
        { ...plan, actions: [{ ...shellIntegration, selected: true }] },
        applyOptions(deps, {}),
      );
    }
  }

  await write(
    deps,
    renderSetupApplyResult({ ...plan, summary: { ...plan.summary, requiredOk: true } }),
  );
  return { code: 0 };
}

async function runSetupSystemCommand(
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

function collectForCommand(
  mode: "check" | "plan" | "apply",
  options: SetupCommandOptions,
  deps: SetupCommandDeps,
  flags: { noBrew?: boolean },
): Promise<SetupFacts> {
  const collectOptions: CollectSetupFactsOptions = { mode };
  if (options.configPath !== undefined) collectOptions.configPath = options.configPath;
  if (deps.cwd !== undefined) collectOptions.cwd = deps.cwd;
  if (deps.homeDir !== undefined) collectOptions.homeDir = deps.homeDir;
  const env = deps.env ?? options.env;
  if (env !== undefined) collectOptions.env = env;
  if (deps.runner !== undefined) collectOptions.runner = deps.runner;
  if (deps.access !== undefined) collectOptions.access = deps.access;
  if (deps.fs !== undefined) collectOptions.fs = deps.fs;
  if (deps.now !== undefined) collectOptions.now = deps.now;
  if (flags.noBrew !== undefined) collectOptions.noBrew = flags.noBrew;
  return collectSetupFacts(collectOptions);
}

function applyOptions(
  deps: SetupCommandDeps,
  input: {
    dryRun?: boolean;
    actionFilter?: (action: SetupAction) => boolean;
  },
): Parameters<typeof applySetupPlan>[1] {
  const options: Parameters<typeof applySetupPlan>[1] = {};
  if (deps.runner !== undefined) options.runner = deps.runner;
  if (deps.fs !== undefined) options.fs = deps.fs;
  if (deps.now !== undefined) options.now = deps.now;
  if (input.dryRun !== undefined) options.dryRun = input.dryRun;
  if (input.actionFilter !== undefined) options.actionFilter = input.actionFilter;
  return options;
}

function dependencyOptionsForCommand(
  deps: SetupCommandDeps,
  env: CliEnv | undefined,
): Parameters<typeof checkSetupWorktrunk>[0] {
  const options: Parameters<typeof checkSetupWorktrunk>[0] = {};
  if (env !== undefined) options.env = env;
  if (deps.runner !== undefined) options.runner = deps.runner;
  if (deps.access !== undefined) options.access = deps.access;
  return options;
}

function isInstallAction(action: SetupAction): boolean {
  return action.kind === "brew-install";
}

function isConfigAction(action: SetupAction): boolean {
  return action.kind === "mkdir" || action.kind === "write-config";
}

function markRequiredIncomplete(plan: SetupPlan): SetupPlan {
  return {
    ...plan,
    summary: {
      ...plan.summary,
      requiredOk: false,
      requiredMissing: Math.max(1, plan.summary.requiredMissing),
    },
  };
}

function coreReadyForConfigWrite(plan: SetupPlan): boolean {
  const nonConfigMissing = plan.checks.some(
    (check) => check.tier === "required" && check.id !== "config" && check.status !== "ok",
  );
  if (nonConfigMissing) {
    return false;
  }
  const config = plan.checks.find((check) => check.id === "config");
  if (config?.status === "ok") {
    return true;
  }
  return (
    config?.status === "missing" &&
    plan.actions.some((action) => isConfigAction(action) && action.selected)
  );
}

function isSupportedHarnessId(value: string): value is SupportedHarnessId {
  return value === "codex" || value === "cursor" || value === "opencode" || value === "pi";
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

async function write(deps: SetupCommandDeps, chunk: string): Promise<void> {
  const writer = deps.writeStdout ?? defaultWriteStdout;
  await writer(chunk);
}

function defaultWriteStdout(chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(chunk, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function defaultPrompt(): SetupPromptAdapter {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return {
    async confirm(message) {
      const answer = await readline.question(`${message} [y/N] `);
      return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
    },
    async select(message, choices) {
      const labels = choices.map((choice, index) => `${index + 1}. ${choice.label}`).join("\n");
      const answer = await readline.question(`${message}\n${labels}\n> `);
      const index = Number(answer.trim()) - 1;
      return choices[index]?.value ?? choices[0]?.value ?? "";
    },
  };
}
