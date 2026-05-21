import type { ProviderProjectConfig, WorktreeObservation, WorktreeRow } from "@wosm/contracts";
import type { RuntimeClock } from "@wosm/runtime";
import type { ObserverPersistence } from "../../persistence/index.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { ObserverCore } from "../../reconcile/core.js";
import type { ObserverEventBus } from "../../runtime/eventBus.js";
import type { CommandHandler, CommandHandlerContext } from "../queue.js";
import { reconcileAndPublish } from "../reconcile.js";
import {
  assertNoCurrentAgent,
  defaultSessionCommandIdFactory,
  findProjectOrThrow,
  launchHarnessInTerminal,
  publishSessionCreated,
  resolveHarnessProviderOrThrow,
  resolveTerminalProviderOrThrow,
  runProviderMutation,
  type SessionCommandIdFactory,
  throwIfAborted,
  worktreeObservationFromRow,
} from "./shared.js";

export type CreateSessionStartAgentHandlerOptions = {
  projects: readonly ProviderProjectConfig[];
  providers: ProviderRegistry;
  core: ObserverCore;
  persistence: ObserverPersistence;
  eventBus?: ObserverEventBus | undefined;
  clock?: RuntimeClock | undefined;
  idFactory?: Partial<SessionCommandIdFactory> | undefined;
  commandTimeoutMs?: number | undefined;
};

export function createSessionStartAgentHandler(
  options: CreateSessionStartAgentHandlerOptions,
): CommandHandler {
  const idFactory = {
    ...defaultSessionCommandIdFactory,
    ...options.idFactory,
  };

  return async (context) => {
    assertSessionStartAgentCommand(context);
    throwIfAborted(context.signal);

    const payload = context.command.payload;
    const project = findProjectOrThrow(options.projects, payload.projectId);
    const terminalProviderId = payload.terminal?.provider ?? project.defaults.terminal;
    const terminal = resolveTerminalProviderOrThrow(options.providers, terminalProviderId);
    const harness = resolveHarnessProviderOrThrow(options.providers, payload.harness.provider);
    const snapshot = options.core.getSnapshot();
    const row = snapshot.rows.find((candidate) => candidate.id === payload.worktreeId);
    validateSnapshotRow(row, payload.projectId);
    assertNoCurrentAgent(row);

    const sessionId = idFactory.sessionId();
    const runtime = {
      clock: options.clock,
      commandTimeoutMs: options.commandTimeoutMs,
      signal: context.signal,
      trace: context.trace,
    };
    const worktree =
      row === undefined
        ? await lookupWorktree({
            providers: options.providers,
            projectId: payload.projectId,
            worktreeId: payload.worktreeId,
            runtime,
          })
        : worktreeObservationFromRow(row, options.providers.worktree.id, now(options.clock));
    throwIfAborted(context.signal);

    const opened = await runProviderMutation(
      {
        ...runtime,
        operation: `provider.${terminal.id}.openWorkspace`,
        fallback: {
          tag: "TerminalProviderError",
          code: "TERMINAL_OPEN_FAILED",
          message: "The terminal provider failed to open the session workspace.",
          provider: terminal.id,
        },
      },
      () =>
        terminal.openWorkspace({
          project,
          worktree,
          harness: harness.id,
          layout: payload.terminal?.layout ?? project.defaults.layout,
          sessionId,
        }),
    );
    throwIfAborted(context.signal);

    const launchPlan = await runProviderMutation(
      {
        ...runtime,
        operation: `provider.${harness.id}.buildLaunch`,
        fallback: {
          tag: "HarnessProviderError",
          code: "HARNESS_BUILD_LAUNCH_FAILED",
          message: "The harness provider failed to build a launch plan.",
          provider: harness.id,
        },
      },
      () =>
        harness.buildLaunch({
          project,
          worktree,
          sessionId,
          ...(payload.harness.mode === undefined ? {} : { mode: payload.harness.mode }),
          ...(payload.initialPrompt === undefined ? {} : { initialPrompt: payload.initialPrompt }),
          ...(payload.harness.profile === undefined ? {} : { profile: payload.harness.profile }),
        }),
    );
    throwIfAborted(context.signal);

    await launchHarnessInTerminal({
      ...runtime,
      terminal,
      request: {
        project,
        worktree,
        terminalTarget: opened.target,
        agentEndpointId: opened.agentEndpointId,
        launchPlan,
      },
    });

    if (payload.terminal?.focus === true) {
      await runProviderMutation(
        {
          ...runtime,
          operation: `provider.${terminal.id}.focusTarget`,
          fallback: {
            tag: "TerminalProviderError",
            code: "TERMINAL_FOCUS_FAILED",
            message: "The terminal provider failed to focus the session target.",
            provider: terminal.id,
          },
        },
        () => terminal.focusTarget(opened.target.targetId),
      );
    }

    const nextSnapshot = await reconcileAndPublish({
      core: options.core,
      eventBus: options.eventBus,
      clock: options.clock,
      reason: "command:session.startAgent",
      trace: context.trace,
    });
    await publishSessionCreated({
      snapshot: nextSnapshot,
      sessionId,
      persistence: options.persistence,
      eventBus: options.eventBus,
      context,
      clock: options.clock,
    });
  };
}

function validateSnapshotRow(row: WorktreeRow | undefined, projectId: string): void {
  if (row === undefined || row.projectId === projectId) {
    return;
  }
  throw {
    tag: "CommandValidationError",
    code: "WORKTREE_PROJECT_MISMATCH",
    message: "The requested worktree belongs to a different configured project.",
    projectId,
    worktreeId: row.id,
  };
}

async function lookupWorktree(input: {
  providers: ProviderRegistry;
  projectId: string;
  worktreeId: string;
  runtime: {
    clock?: RuntimeClock | undefined;
    commandTimeoutMs?: number | undefined;
    signal?: AbortSignal | undefined;
    trace?:
      | {
          traceId?: string | undefined;
          spanId?: string | undefined;
          operation?: string | undefined;
        }
      | undefined;
  };
}): Promise<WorktreeObservation> {
  if (input.providers.worktree.getWorktree === undefined) {
    throw worktreeMissingError(input.projectId, input.worktreeId);
  }

  const worktree = await runProviderMutation(
    {
      ...input.runtime,
      operation: `provider.${input.providers.worktree.id}.getWorktree`,
      fallback: {
        tag: "WorktreeProviderError",
        code: "WORKTREE_LOOKUP_FAILED",
        message: "The worktree provider failed to look up the worktree.",
        provider: input.providers.worktree.id,
      },
    },
    () =>
      input.providers.worktree.getWorktree?.({
        projectId: input.projectId,
        worktreeId: input.worktreeId,
      }) as Promise<WorktreeObservation | null>,
  );
  if (worktree === null) {
    throw worktreeMissingError(input.projectId, input.worktreeId);
  }
  return worktree;
}

function worktreeMissingError(projectId: string, worktreeId: string) {
  return {
    tag: "CommandValidationError",
    code: "WORKTREE_NOT_FOUND",
    message: "The requested worktree is not visible to the worktree provider.",
    projectId,
    worktreeId,
  };
}

function now(clock: RuntimeClock | undefined): string {
  return (clock?.now() ?? new Date()).toISOString();
}

function assertSessionStartAgentCommand(
  context: CommandHandlerContext,
): asserts context is CommandHandlerContext & {
  command: Extract<CommandHandlerContext["command"], { type: "session.startAgent" }>;
} {
  if (context.command.type !== "session.startAgent") {
    throw new Error(`Expected session.startAgent command, received ${context.command.type}.`);
  }
}
