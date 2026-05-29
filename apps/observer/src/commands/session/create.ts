import type { ProviderProjectConfig, WorktreeObservation } from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import type { RuntimeClock } from "@wosm/runtime";
import type { ObserverPersistence } from "../../persistence/index.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { ObserverCore } from "../../reconcile/core.js";
import type { ObserverEventBus } from "../../runtime/eventBus.js";
import { nowIso } from "../../utils/time.js";
import { assertCommandType } from "../assertCommand.js";
import type { CommandHandler } from "../queue.js";
import { reconcileAndPublish } from "../reconcile.js";
import {
  closeTerminalTargetBestEffort,
  defaultSessionCommandIdFactory,
  findProjectOrThrow,
  focusTerminalTargetBestEffort,
  launchHarnessInTerminal,
  publishSessionCreated,
  removeWorktreeBestEffort,
  resolveHarnessProviderOrThrow,
  resolveTerminalProviderOrThrow,
  runProviderMutation,
  type SessionCommandIdFactory,
  terminalTargetObservationFromBinding,
  throwIfAborted,
} from "./shared.js";

export type CreateSessionCreateHandlerOptions = {
  projects: readonly ProviderProjectConfig[];
  providers: ProviderRegistry;
  core: ObserverCore;
  persistence: ObserverPersistence;
  eventBus?: ObserverEventBus | undefined;
  clock?: RuntimeClock | undefined;
  idFactory?: Partial<SessionCommandIdFactory> | undefined;
  logger?: JsonlLogger | undefined;
  commandTimeoutMs?: number | undefined;
};

export function createSessionCreateHandler(
  options: CreateSessionCreateHandlerOptions,
): CommandHandler {
  const idFactory = {
    ...defaultSessionCommandIdFactory,
    ...options.idFactory,
  };

  return async (context) => {
    assertCommandType(context, "session.create");
    throwIfAborted(context.signal);

    const payload = context.command.payload;
    const project = findProjectOrThrow(options.projects, payload.projectId);
    const terminal = resolveTerminalProviderOrThrow(options.providers, payload.terminal.provider);
    const harness = resolveHarnessProviderOrThrow(options.providers, payload.harness.provider);
    const sessionId = idFactory.sessionId();
    const runtime = {
      clock: options.clock,
      commandTimeoutMs: options.commandTimeoutMs,
      signal: context.signal,
      trace: context.trace,
    };
    let createdWorktree: WorktreeObservation | undefined;
    let openedTargetId: string | undefined;
    let harnessLaunched = false;

    try {
      const worktree = await runProviderMutation(
        {
          ...runtime,
          operation: `provider.${options.providers.worktree.id}.createWorktree`,
          fallback: {
            tag: "WorktreeProviderError",
            code: "WORKTREE_CREATE_FAILED",
            message: "The worktree provider failed to create the session worktree.",
            provider: options.providers.worktree.id,
          },
        },
        () =>
          options.providers.worktree.createWorktree({
            project,
            branch: payload.branch,
            ...(payload.base === undefined ? {} : { base: payload.base }),
          }),
      );
      createdWorktree = worktree;
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
            layout: payload.terminal.layout ?? project.defaults.layout,
            sessionId,
          }),
      );
      openedTargetId = opened.target.targetId;
      throwIfAborted(context.signal);
      const terminalTarget = terminalTargetObservationFromBinding({
        binding: opened.target,
        worktree,
        observedAt: now(options.clock),
      });

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
            terminalTarget,
            sessionId,
            ...(payload.harness.mode === undefined ? {} : { mode: payload.harness.mode }),
            ...(payload.initialPrompt === undefined
              ? {}
              : { initialPrompt: payload.initialPrompt }),
            ...(payload.harness.profile === undefined ? {} : { profile: payload.harness.profile }),
            ...(payload.harness.approvalPolicy === undefined
              ? {}
              : { approvalPolicy: payload.harness.approvalPolicy }),
            ...(payload.harness.sandboxMode === undefined
              ? {}
              : { sandboxMode: payload.harness.sandboxMode }),
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
      harnessLaunched = true;

      if (payload.terminal.focus === true) {
        await focusTerminalTargetBestEffort({
          terminal,
          targetId: opened.target.targetId,
          context,
          logger: options.logger,
          clock: options.clock,
          commandTimeoutMs: options.commandTimeoutMs,
        });
      }
    } catch (error) {
      if (!harnessLaunched) {
        if (openedTargetId !== undefined) {
          await closeTerminalTargetBestEffort({
            terminal,
            targetId: openedTargetId,
            context,
            logger: options.logger,
            clock: options.clock,
            commandTimeoutMs: options.commandTimeoutMs,
          });
        }
        if (createdWorktree !== undefined) {
          await removeWorktreeBestEffort({
            providers: options.providers,
            projectId: project.id,
            worktreeId: createdWorktree.id,
            context,
            logger: options.logger,
            clock: options.clock,
            commandTimeoutMs: options.commandTimeoutMs,
          });
        }
      }
      throw error;
    }

    const snapshot = await reconcileAndPublish({
      core: options.core,
      eventBus: options.eventBus,
      clock: options.clock,
      reason: "command:session.create",
      trace: context.trace,
    });
    await publishSessionCreated({
      snapshot,
      sessionId,
      persistence: options.persistence,
      eventBus: options.eventBus,
      context,
      clock: options.clock,
    });
  };
}

const now = nowIso;
