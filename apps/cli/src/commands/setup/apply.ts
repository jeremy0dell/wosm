import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type ExternalCommandRunner, runExternalCommand } from "@wosm/runtime";
import type { SetupAction, SetupPlan } from "./model.js";

export type SetupApplyFileSystem = {
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  access(path: string): Promise<void>;
};

export type ApplySetupPlanOptions = {
  runner?: ExternalCommandRunner;
  fs?: SetupApplyFileSystem;
  dryRun?: boolean;
  now?: () => Date;
  actionFilter?: (action: SetupAction) => boolean;
};

export type ApplySetupPlanResult = {
  plan: SetupPlan;
  failedAction?: SetupAction;
};

export async function applySetupPlan(
  plan: SetupPlan,
  options: ApplySetupPlanOptions = {},
): Promise<ApplySetupPlanResult> {
  const actions: SetupAction[] = [];
  const fs = options.fs ?? nodeApplyFs();
  for (const action of plan.actions) {
    if (!action.selected || options.actionFilter?.(action) === false) {
      actions.push({ ...action, status: "skipped" });
      continue;
    }
    if (options.dryRun === true) {
      actions.push({ ...action, status: "skipped" });
      continue;
    }
    try {
      const context: {
        fs: SetupApplyFileSystem;
        runner?: ExternalCommandRunner;
        now?: () => Date;
      } = {
        fs,
      };
      if (options.runner !== undefined) context.runner = options.runner;
      if (options.now !== undefined) context.now = options.now;
      await applyAction(action, context);
      actions.push({ ...action, status: "completed" });
    } catch {
      const failed = { ...action, status: "failed" as const };
      actions.push(failed);
      return {
        plan: { ...plan, actions: [...actions, ...remainingSkipped(plan.actions, actions.length)] },
        failedAction: failed,
      };
    }
  }
  return { plan: { ...plan, actions } };
}

async function applyAction(
  action: SetupAction,
  options: { fs: SetupApplyFileSystem; runner?: ExternalCommandRunner; now?: () => Date },
): Promise<void> {
  switch (action.kind) {
    case "brew-install":
    case "run-command":
      await runActionCommand(action, options.runner);
      return;
    case "mkdir":
      if (action.path === undefined) throw new Error("mkdir action requires path.");
      await options.fs.mkdir(dirname(action.path), { recursive: true });
      return;
    case "write-config":
      await writeConfigAction(action, options);
      return;
    case "noop":
      return;
  }
}

async function runActionCommand(action: SetupAction, runner: ExternalCommandRunner | undefined) {
  const command = action.command;
  if (command === undefined || command.length === 0) {
    throw new Error(`${action.id} action requires a command.`);
  }
  const [binary, ...args] = command;
  if (binary === undefined) {
    throw new Error(`${action.id} action requires a command.`);
  }
  await runExternalCommand({ command: binary, args, maxOutputChars: 4096 }, runner);
}

async function writeConfigAction(
  action: SetupAction,
  options: { fs: SetupApplyFileSystem; now?: () => Date },
): Promise<void> {
  const path = action.path;
  const content = action.data?.content;
  if (path === undefined || content === undefined) {
    throw new Error("write-config action requires path and content.");
  }
  const backupPath = await backupExistingConfig(path, options);
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await options.fs.writeFile(tempPath, content);
  await options.fs.rename(tempPath, path);
  if (backupPath !== undefined) {
    action.data = { ...(action.data ?? {}), backupPath };
  }
}

async function backupExistingConfig(
  path: string,
  options: { fs: SetupApplyFileSystem; now?: () => Date },
): Promise<string | undefined> {
  try {
    await options.fs.access(path);
  } catch {
    return undefined;
  }
  const content = await options.fs.readFile(path);
  const stamp = (options.now ?? (() => new Date()))().toISOString().replaceAll(/[:.]/g, "-");
  const backupPath = `${path}.${stamp}.bak`;
  await options.fs.writeFile(backupPath, content);
  return backupPath;
}

function remainingSkipped(actions: readonly SetupAction[], completedCount: number): SetupAction[] {
  return actions.slice(completedCount).map((action) => ({ ...action, status: "skipped" }));
}

function nodeApplyFs(): SetupApplyFileSystem {
  return {
    async mkdir(path, options) {
      await mkdir(path, options);
    },
    async readFile(path) {
      return readFile(path, "utf8");
    },
    async writeFile(path, content) {
      await writeFile(path, content, "utf8");
    },
    rename,
    access,
  };
}
