import { randomUUID } from "node:crypto";
import type {
  HarnessProvider,
  ProviderProjectConfig,
  SafeError,
  SessionId,
  SessionView,
  TerminalLaunchProcessRequest,
  TerminalLaunchProcessResult,
  TerminalProvider,
  WorktreeObservation,
  WorktreeRow,
  WosmSnapshot,
} from "@wosm/contracts";
import {
  type RuntimeClock,
  type RuntimeSafeErrorFallback,
  runRuntimeBoundaryWithTimeout,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import type { ObserverPersistence } from "../../persistence/index.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { ObserverEventBus } from "../../runtime/eventBus.js";
import type { CommandHandlerContext } from "../queue.js";

export type SessionCommandIdFactory = {
  sessionId(): SessionId;
};

export type SessionCommandRuntime = {
  clock?: RuntimeClock | undefined;
  commandTimeoutMs?: number | undefined;
};

export const defaultSessionCommandIdFactory: SessionCommandIdFactory = {
  sessionId: () => `ses_${randomUUID()}`,
};

export function findProjectOrThrow(
  projects: readonly ProviderProjectConfig[],
  projectId: string,
): ProviderProjectConfig {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (project !== undefined) {
    return project;
  }
  throw safeError({
    tag: "CommandValidationError",
    code: "PROJECT_NOT_CONFIGURED",
    message: "This project is not configured in wosm.",
    hint: "Add the project to config.toml and retry.",
    projectId,
  });
}

export function resolveTerminalProviderOrThrow(
  providers: ProviderRegistry,
  providerId: string,
): TerminalProvider {
  if (providers.terminal.id === providerId) {
    return providers.terminal;
  }
  throw safeError({
    tag: "TerminalProviderError",
    code: "TERMINAL_PROVIDER_UNAVAILABLE",
    message: "The requested terminal provider is not registered.",
    provider: providerId,
  });
}

export function resolveHarnessProviderOrThrow(
  providers: ProviderRegistry,
  providerId: string,
): HarnessProvider {
  const provider = providers.harnesses.get(providerId);
  if (provider !== undefined) {
    return provider;
  }
  throw safeError({
    tag: "HarnessProviderError",
    code: "HARNESS_PROVIDER_UNAVAILABLE",
    message: "The requested harness provider is not registered.",
    provider: providerId,
  });
}

export function assertNoCurrentAgent(row: WorktreeRow | undefined): void {
  if (row?.agent === undefined) {
    return;
  }
  throw safeError({
    tag: "CommandValidationError",
    code: "SESSION_ALREADY_HAS_AGENT",
    message: "This worktree already has a primary agent session.",
    hint: "Focus the existing agent or close it before starting a new one.",
    worktreeId: row.id,
    ...(row.agent.sessionId === undefined ? {} : { sessionId: row.agent.sessionId }),
  });
}

export function worktreeObservationFromRow(
  row: WorktreeRow,
  provider: string,
  observedAt: string,
): WorktreeObservation {
  return {
    id: row.id,
    provider,
    projectId: row.projectId,
    branch: row.branch,
    path: row.path,
    state: row.worktree.state,
    source: row.worktree.source,
    ...(row.worktree.dirty === undefined ? {} : { dirty: row.worktree.dirty }),
    ...(row.worktree.ahead === undefined ? {} : { ahead: row.worktree.ahead }),
    ...(row.worktree.behind === undefined ? {} : { behind: row.worktree.behind }),
    ...(row.worktree.pr === undefined ? {} : { pr: row.worktree.pr }),
    confidence: "high",
    reason: "Resolved from the current observer snapshot.",
    observedAt,
  };
}

export async function runProviderMutation<T>(
  input: {
    operation: string;
    fallback: RuntimeSafeErrorFallback;
    timeoutFallback?: RuntimeSafeErrorFallback | undefined;
    trace?:
      | {
          traceId?: string | undefined;
          spanId?: string | undefined;
          operation?: string | undefined;
        }
      | undefined;
    signal?: AbortSignal | undefined;
  } & SessionCommandRuntime,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const clock = input.clock ?? systemClock;
  const result = await runRuntimeBoundaryWithTimeout(
    {
      operation: input.operation,
      clock,
      timeoutMs: input.commandTimeoutMs ?? 30_000,
      error: input.fallback,
      ...(input.timeoutFallback === undefined ? {} : { timeoutError: input.timeoutFallback }),
      ...(input.trace === undefined ? {} : { trace: input.trace }),
    },
    async ({ signal }) => {
      const linked = linkAbortSignals(signal, input.signal);
      try {
        throwIfAborted(linked.signal);
        const value = await task(linked.signal);
        throwIfAborted(linked.signal);
        return value;
      } finally {
        linked.cleanup();
      }
    },
  );

  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

export async function launchHarnessInTerminal(
  input: {
    terminal: TerminalProvider;
    request: TerminalLaunchProcessRequest;
    trace?:
      | {
          traceId?: string | undefined;
          spanId?: string | undefined;
          operation?: string | undefined;
        }
      | undefined;
    signal?: AbortSignal | undefined;
  } & SessionCommandRuntime,
): Promise<TerminalLaunchProcessResult> {
  if (input.terminal.launchProcess === undefined) {
    throw safeError({
      tag: "TerminalProviderError",
      code: "TERMINAL_LAUNCH_UNSUPPORTED",
      message: "The configured terminal provider cannot launch harness processes.",
      provider: input.terminal.id,
      worktreeId: input.request.worktree.id,
      ...(input.request.terminalTarget.sessionId === undefined
        ? {}
        : { sessionId: input.request.terminalTarget.sessionId }),
    });
  }

  return runProviderMutation(
    {
      operation: `provider.${input.terminal.id}.launchProcess`,
      ...(input.clock === undefined ? {} : { clock: input.clock }),
      ...(input.commandTimeoutMs === undefined ? {} : { commandTimeoutMs: input.commandTimeoutMs }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.trace === undefined ? {} : { trace: input.trace }),
      fallback: {
        tag: "TerminalProviderError",
        code: "TERMINAL_LAUNCH_FAILED",
        message: "The terminal provider failed to launch the harness process.",
        provider: input.terminal.id,
      },
      timeoutFallback: {
        tag: "TimeoutError",
        code: "TERMINAL_LAUNCH_TIMEOUT",
        message: "The terminal provider timed out while launching the harness process.",
        provider: input.terminal.id,
      },
    },
    (signal) =>
      input.terminal.launchProcess?.({
        ...input.request,
        signal,
      }) as Promise<TerminalLaunchProcessResult>,
  );
}

export async function publishSessionCreated(input: {
  snapshot: WosmSnapshot;
  sessionId: SessionId;
  persistence: ObserverPersistence;
  eventBus?: ObserverEventBus | undefined;
  context: CommandHandlerContext;
  clock?: RuntimeClock | undefined;
}): Promise<SessionView | undefined> {
  const session = input.snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
  if (session === undefined) {
    return undefined;
  }

  const event = { type: "session.created" as const, session };
  await input.persistence.recordEvent(event, {
    commandId: input.context.commandId,
    traceId: input.context.trace.traceId,
    spanId: input.context.trace.spanId,
    createdAt: toIsoTimestamp((input.clock ?? systemClock).now()),
  });
  input.eventBus?.publish(event);
  return session;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  throw (
    signal.reason ??
    safeError({
      tag: "CancellationError",
      code: "COMMAND_CANCELLED",
      message: "Observer command was cancelled.",
    })
  );
}

function safeError(input: SafeError): SafeError {
  return input;
}

function linkAbortSignals(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  cleanup(): void;
} {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  for (const signal of signals) {
    if (signal === undefined) {
      continue;
    }
    if (signal.aborted) {
      abort(signal);
      continue;
    }
    const listener = () => abort(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push(() => signal.removeEventListener("abort", listener));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
