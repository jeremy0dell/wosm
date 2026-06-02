import {
  ObserverEventHookInvocationSchema,
  type WorktreeRow,
  type WosmEvent,
} from "@wosm/contracts";
import type { ExternalCommandRunner } from "@wosm/runtime";
import {
  buildClickFocusShellCommand,
  buildFocusCommand,
  defaultCliCommandParts,
} from "./notify/focusAction.js";
import { playMacNotificationSound, showMacNotification } from "./notify/macos.js";

export type NotifyCommandOptions = {
  stdin?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  configPath?: string | undefined;
};

export type NotifyCommandDeps = {
  commandRunner?: ExternalCommandRunner;
  cliCommandParts?: string[] | undefined;
  platform?: NodeJS.Platform;
};

export type NotifyCommandResult = {
  notified: boolean;
  skipped?: boolean;
  reason?: string;
  title?: string;
  message?: string;
  notifier?: "terminal-notifier" | "osascript";
  sound?: "played" | "failed" | "skipped";
  clickAction?: boolean;
};

type WorktreeAgent = NonNullable<WorktreeRow["agent"]>;
type WorktreeAgentStateChangedEvent = Extract<WosmEvent, { type: "worktree.agentStateChanged" }>;
type NotificationKind = "finished" | "needs_attention";

type NotifiableAgentEvent = {
  event: WorktreeAgentStateChangedEvent;
  agent: WorktreeAgent;
  kind: NotificationKind;
};

function notificationMessage(agent: WorktreeAgent): string {
  const harness = agent.harness;
  return agent.reason === undefined ? `${harness} is idle.` : agent.reason;
}

function notificationSubject(event: WorktreeAgentStateChangedEvent, agent: WorktreeAgent): string {
  return agent.sessionId ?? event.worktreeId;
}

function notificationTitle(input: NotifiableAgentEvent): string {
  const subject = notificationSubject(input.event, input.agent);
  return input.kind === "needs_attention" ? `${subject} needs attention` : `${subject} finished`;
}

function notifiableAgentEvent(
  event: WorktreeAgentStateChangedEvent,
): NotifiableAgentEvent | undefined {
  const agent = event.agent;
  if (agent === undefined) {
    return undefined;
  }
  if (agent.state === "idle") {
    return { event, agent, kind: "finished" };
  }
  if (agent.state === "needs_attention") {
    return { event, agent, kind: "needs_attention" };
  }
  return undefined;
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
  const invocation = ObserverEventHookInvocationSchema.parse(JSON.parse(source));
  if (invocation.event.type !== "worktree.agentStateChanged") {
    return { notified: false, skipped: true, reason: "unsupported-event" };
  }
  const notifiable = notifiableAgentEvent(invocation.event);
  if (notifiable === undefined) {
    return { notified: false, skipped: true, reason: "agent-not-notifiable" };
  }
  const title = notificationTitle(notifiable);
  const message = notificationMessage(notifiable.agent);
  const platform = deps.platform ?? options.platform ?? process.platform;
  if (platform !== "darwin") {
    return { notified: false, skipped: true, reason: "unsupported-platform", title, message };
  }

  const focusCommand = buildFocusCommand(notifiable.event);
  const clickAction = buildClickFocusShellCommand({
    command: focusCommand,
    cliCommandParts: deps.cliCommandParts ?? defaultCliCommandParts(),
    configPath: options.configPath,
  });
  const group = `wosm:${notificationSubject(notifiable.event, notifiable.agent)}`;
  const soundPromise = playMacNotificationSound({
    kind: notifiable.kind,
    commandRunner: deps.commandRunner,
  });
  const notifier = await showMacNotification(
    {
      title,
      message,
      group,
      clickAction,
    },
    deps.commandRunner,
  );
  const sound = await soundPromise;
  return {
    notified: true,
    title,
    message,
    notifier,
    sound,
    clickAction: notifier === "terminal-notifier",
  };
}
