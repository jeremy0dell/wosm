import { EventHookInvocationSchema, type WorktreeRow } from "@wosm/contracts";
import { type ExternalCommandRunner, runExternalCommand } from "@wosm/runtime";

export type NotifyCommandOptions = {
  stdin?: string | undefined;
  platform?: NodeJS.Platform | undefined;
};

export type NotifyCommandDeps = {
  commandRunner?: ExternalCommandRunner;
  platform?: NodeJS.Platform;
};

export type NotifyCommandResult = {
  notified: boolean;
  skipped?: boolean;
  reason?: string;
  title?: string;
  message?: string;
};

type WorktreeAgent = NonNullable<WorktreeRow["agent"]>;

function notificationMessage(agent: WorktreeAgent): string {
  const harness = agent.harness;
  return agent.reason === undefined ? `${harness} is idle.` : agent.reason;
}

function appleScriptString(value: string): string {
  return JSON.stringify(value);
}

export async function runNotifyCommand(
  args: string[],
  options: NotifyCommandOptions = {},
  deps: NotifyCommandDeps = {},
): Promise<NotifyCommandResult> {
  const [kind] = args;
  if (kind !== "turn-completion") {
    throw new Error("Usage: wosm notify turn-completion");
  }
  const source = options.stdin?.trim();
  if (source === undefined || source.length === 0) {
    throw new Error("wosm notify turn-completion requires an event hook invocation on stdin.");
  }
  const invocation = EventHookInvocationSchema.parse(JSON.parse(source));
  if (invocation.event.type !== "worktree.agentStateChanged") {
    return { notified: false, skipped: true, reason: "unsupported-event" };
  }
  const agent = invocation.event.agent;
  if (agent?.state !== "idle") {
    return { notified: false, skipped: true, reason: "agent-not-idle" };
  }
  const title = "Agent turn complete";
  const message = notificationMessage(agent);
  const platform = deps.platform ?? options.platform ?? process.platform;
  if (platform !== "darwin") {
    return { notified: false, skipped: true, reason: "unsupported-platform", title, message };
  }
  await runExternalCommand(
    {
      command: "osascript",
      args: [
        "-e",
        `display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`,
      ],
      timeoutMs: 3000,
    },
    deps.commandRunner,
  );
  return { notified: true, title, message };
}
