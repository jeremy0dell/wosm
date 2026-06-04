import type {
  BuildHarnessLaunchRequest,
  EnsureAgentWorkspaceIntent,
  HarnessProvider,
  SafeError,
  TerminalFocusOrigin,
  TerminalIntent,
  TerminalIntentReceipt,
  TerminalProvider,
  TerminalTargetObservation,
  TraceContext,
} from "@wosm/contracts";
import {
  TerminalIntentReceiptSchema,
  TerminalIntentSchema,
  terminalTargetObservationFromBinding,
} from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import { type RuntimeClock, systemClock, toIsoTimestamp } from "@wosm/runtime";
import { throwIfAborted } from "../commands/cancellation.js";
import { launchHarnessInTerminal, runProviderMutation } from "../commands/session/shared.js";
import { toSafeError } from "../diagnostics/errors.js";

export type TerminalIntentSubmitContext = {
  trace?: TraceContext | undefined;
  signal?: AbortSignal | undefined;
  commandTimeoutMs?: number | undefined;
};

export type TerminalIntentRunner = {
  submitIntent(
    intent: TerminalIntent,
    context?: TerminalIntentSubmitContext,
  ): Promise<TerminalIntentReceipt>;
};

export type TerminalIntentProviderAccess = {
  terminal: TerminalProvider;
  harnesses: Map<string, HarnessProvider>;
};

export type DefaultTerminalIntentRunnerOptions = {
  providers: TerminalIntentProviderAccess;
  clock?: RuntimeClock | undefined;
  logger?: JsonlLogger | undefined;
  commandTimeoutMs?: number | undefined;
};

export class DefaultTerminalIntentRunner implements TerminalIntentRunner {
  readonly #providers: TerminalIntentProviderAccess;
  readonly #clock: RuntimeClock;
  readonly #logger: JsonlLogger | undefined;
  readonly #commandTimeoutMs: number | undefined;
  readonly #receipts = new Map<string, Promise<TerminalIntentReceipt>>();

  constructor(options: DefaultTerminalIntentRunnerOptions) {
    this.#providers = options.providers;
    this.#clock = options.clock ?? systemClock;
    this.#logger = options.logger;
    this.#commandTimeoutMs = options.commandTimeoutMs;
  }

  submitIntent(
    intent: TerminalIntent,
    context: TerminalIntentSubmitContext = {},
  ): Promise<TerminalIntentReceipt> {
    const parsed = TerminalIntentSchema.safeParse(intent);
    if (!parsed.success) {
      return Promise.resolve(
        this.#rejected(intent, parsed.error, {
          tag: "CommandValidationError",
          code: "TERMINAL_INTENT_INVALID",
          message: "The terminal intent payload is invalid.",
        }),
      );
    }

    const key = `${parsed.data.commandId}:${parsed.data.type}`;
    const existing = this.#receipts.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const submitted = this.#submitParsedIntent(parsed.data, context);
    this.#receipts.set(key, submitted);
    return submitted;
  }

  async #submitParsedIntent(
    intent: TerminalIntent,
    context: TerminalIntentSubmitContext,
  ): Promise<TerminalIntentReceipt> {
    await this.#logger?.info("Terminal intent submitted.", intentLogAttributes(intent, context));

    try {
      if (context.signal !== undefined) {
        throwIfAborted(context.signal);
      }

      let receipt: TerminalIntentReceipt;
      switch (intent.type) {
        case "session.ensureAgentWorkspace":
          receipt = await this.#ensureAgentWorkspace(intent, context);
          break;
        case "terminal.focus":
        case "terminal.close":
          receipt = this.#rejected(intent, unsupportedIntentError(intent));
          break;
      }
      await this.#logReceipt(intent, receipt, context);
      return receipt;
    } catch (error) {
      const receipt = this.#rejected(intent, error, {
        tag: "TerminalIntentRunnerError",
        code: "TERMINAL_INTENT_FAILED",
        message: "The terminal intent runner failed.",
      });
      await this.#logReceipt(intent, receipt, context);
      return receipt;
    }
  }

  async #ensureAgentWorkspace(
    intent: EnsureAgentWorkspaceIntent,
    context: TerminalIntentSubmitContext,
  ): Promise<TerminalIntentReceipt> {
    const terminal = this.#providers.terminal;
    if (terminal.id !== intent.terminalProvider) {
      return this.#rejected(intent, {
        tag: "TerminalProviderError",
        code: "TERMINAL_PROVIDER_UNAVAILABLE",
        message: "The requested terminal provider is not registered.",
        provider: intent.terminalProvider,
        commandId: intent.commandId,
      });
    }

    const harness = this.#providers.harnesses.get(intent.harness.provider);
    if (harness === undefined) {
      return this.#rejected(intent, {
        tag: "HarnessProviderError",
        code: "HARNESS_PROVIDER_UNAVAILABLE",
        message: "The requested harness provider is not registered.",
        provider: intent.harness.provider,
        commandId: intent.commandId,
      });
    }

    const runtime = runtimeOptions({
      clock: this.#clock,
      defaultCommandTimeoutMs: this.#commandTimeoutMs,
      context,
    });
    let opened: Awaited<ReturnType<TerminalProvider["openWorkspace"]>> | undefined;

    try {
      opened = await runProviderMutation(
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
            project: intent.project,
            worktree: intent.worktree,
            harness: harness.id,
            layout: intent.layout,
            sessionId: intent.sessionId,
          }),
      );

      if (context.signal !== undefined) {
        throwIfAborted(context.signal);
      }

      const terminalTarget = terminalTargetObservationFromBinding({
        binding: opened.target,
        worktree: intent.worktree,
        observedAt: timestamp(this.#clock),
      });
      const buildRequest = buildLaunchRequest(intent, terminalTarget);
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
        () => harness.buildLaunch(buildRequest),
      );

      if (context.signal !== undefined) {
        throwIfAborted(context.signal);
      }

      await launchHarnessInTerminal({
        ...runtime,
        terminal,
        request: {
          project: intent.project,
          worktree: intent.worktree,
          terminalTarget: opened.target,
          agentEndpointId: opened.agentEndpointId,
          launchPlan,
        },
      });

      if (intent.focus === true) {
        await this.#focusTargetBestEffort({
          terminal,
          targetId: opened.target.targetId,
          origin: intent.origin,
          context,
        });
      }

      return this.#accepted(intent);
    } catch (error) {
      if (opened !== undefined) {
        await this.#closeOpenedTargetBestEffort({
          terminal,
          targetId: opened.target.targetId,
          context,
        });
      }
      return this.#rejected(intent, error, {
        tag: "TerminalIntentRunnerError",
        code: "TERMINAL_INTENT_FAILED",
        message: "The terminal intent runner failed.",
      });
    }
  }

  async #closeOpenedTargetBestEffort(input: {
    terminal: TerminalProvider;
    targetId: string;
    context: TerminalIntentSubmitContext;
  }): Promise<void> {
    try {
      await runProviderMutation(
        {
          operation: `provider.${input.terminal.id}.closeTarget.cleanup`,
          clock: this.#clock,
          commandTimeoutMs: cleanupTimeoutMs(
            input.context.commandTimeoutMs ?? this.#commandTimeoutMs,
          ),
          signal: input.context.signal,
          trace: input.context.trace,
          fallback: {
            tag: "TerminalProviderError",
            code: "TERMINAL_CLEANUP_CLOSE_FAILED",
            message: "The terminal provider failed to close a target during cleanup.",
            provider: input.terminal.id,
          },
        },
        () => input.terminal.closeTarget(input.targetId),
      );
    } catch (error) {
      await this.#logger?.warn("Terminal intent cleanup failed to close terminal target.", {
        targetId: input.targetId,
        terminalProvider: input.terminal.id,
        traceId: input.context.trace?.traceId,
        error,
      });
    }
  }

  async #focusTargetBestEffort(input: {
    terminal: TerminalProvider;
    targetId: string;
    origin?: TerminalFocusOrigin | undefined;
    context: TerminalIntentSubmitContext;
  }): Promise<void> {
    try {
      await runProviderMutation(
        {
          operation: `provider.${input.terminal.id}.focusTarget`,
          clock: this.#clock,
          commandTimeoutMs: input.context.commandTimeoutMs ?? this.#commandTimeoutMs,
          signal: input.context.signal,
          trace: input.context.trace,
          fallback: {
            tag: "TerminalProviderError",
            code: "TERMINAL_FOCUS_FAILED",
            message: "The terminal provider failed to focus the session target.",
            provider: input.terminal.id,
          },
        },
        () => input.terminal.focusTarget(input.targetId, focusContext(input.origin)),
      );
    } catch (error) {
      await this.#logger?.warn("Terminal focus failed after session launch.", {
        targetId: input.targetId,
        terminalProvider: input.terminal.id,
        traceId: input.context.trace?.traceId,
        error,
      });
    }
  }

  #accepted(intent: TerminalIntent): TerminalIntentReceipt {
    return TerminalIntentReceiptSchema.parse({
      status: "accepted",
      accepted: true,
      commandId: intent.commandId,
      type: intent.type,
      terminalProvider: intent.terminalProvider,
      timestamp: timestamp(this.#clock),
    });
  }

  #rejected(
    intent: TerminalIntent,
    error: unknown,
    fallback: {
      tag: string;
      code: string;
      message: string;
      provider?: string;
    } = {
      tag: "TerminalIntentRunnerError",
      code: "TERMINAL_INTENT_FAILED",
      message: "The terminal intent runner failed.",
    },
  ): TerminalIntentReceipt {
    const safeError = toSafeError(error, fallback, {
      commandId: intent.commandId,
    });
    return TerminalIntentReceiptSchema.parse({
      status: "rejected",
      accepted: false,
      commandId: intent.commandId,
      type: intent.type,
      terminalProvider: intent.terminalProvider,
      timestamp: timestamp(this.#clock),
      error: safeError,
    });
  }

  async #logReceipt(
    intent: TerminalIntent,
    receipt: TerminalIntentReceipt,
    context: TerminalIntentSubmitContext,
  ): Promise<void> {
    if (receipt.status === "accepted") {
      await this.#logger?.info("Terminal intent accepted.", intentLogAttributes(intent, context));
      return;
    }
    await this.#logger?.warn("Terminal intent rejected.", {
      ...intentLogAttributes(intent, context),
      error: receipt.error,
      errorCode: receipt.error.code,
      errorProvider: receipt.error.provider,
    });
  }
}

export function createTerminalIntentRunner(
  options: DefaultTerminalIntentRunnerOptions,
): TerminalIntentRunner {
  return new DefaultTerminalIntentRunner(options);
}

function buildLaunchRequest(
  intent: EnsureAgentWorkspaceIntent,
  terminalTarget: TerminalTargetObservation,
): BuildHarnessLaunchRequest {
  const request: BuildHarnessLaunchRequest = {
    project: intent.project,
    worktree: intent.worktree,
    terminalTarget,
    sessionId: intent.sessionId,
  };
  if (intent.harness.mode !== undefined) request.mode = intent.harness.mode;
  if (intent.initialPrompt !== undefined) request.initialPrompt = intent.initialPrompt;
  if (intent.harness.profile !== undefined) request.profile = intent.harness.profile;
  if (intent.harness.permissionMode !== undefined) {
    request.permissionMode = intent.harness.permissionMode;
  }
  if (intent.harness.approvalPolicy !== undefined) {
    request.approvalPolicy = intent.harness.approvalPolicy;
  }
  if (intent.harness.sandboxMode !== undefined) request.sandboxMode = intent.harness.sandboxMode;
  return request;
}

function runtimeOptions(input: {
  clock: RuntimeClock;
  defaultCommandTimeoutMs: number | undefined;
  context: TerminalIntentSubmitContext;
}) {
  const runtime: {
    clock: RuntimeClock;
    commandTimeoutMs?: number | undefined;
    signal?: AbortSignal | undefined;
    trace?: TraceContext | undefined;
  } = {
    clock: input.clock,
  };
  const commandTimeoutMs = input.context.commandTimeoutMs ?? input.defaultCommandTimeoutMs;
  if (commandTimeoutMs !== undefined) runtime.commandTimeoutMs = commandTimeoutMs;
  if (input.context.signal !== undefined) runtime.signal = input.context.signal;
  if (input.context.trace !== undefined) runtime.trace = input.context.trace;
  return runtime;
}

function focusContext(
  origin: TerminalFocusOrigin | undefined,
): { origin?: TerminalFocusOrigin } | undefined {
  if (origin === undefined) {
    return undefined;
  }
  return { origin };
}

function unsupportedIntentError(intent: TerminalIntent): SafeError {
  return {
    tag: "CommandValidationError",
    code: "TERMINAL_INTENT_UNSUPPORTED",
    message: "This terminal intent is not implemented by the observer runner yet.",
    commandId: intent.commandId,
    provider: intent.terminalProvider,
  };
}

function intentLogAttributes(
  intent: TerminalIntent,
  context: TerminalIntentSubmitContext,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    commandId: intent.commandId,
    intentType: intent.type,
    terminalProvider: intent.terminalProvider,
  };
  if (context.trace?.traceId !== undefined) attributes.traceId = context.trace.traceId;
  if (context.trace?.spanId !== undefined) attributes.spanId = context.trace.spanId;
  switch (intent.type) {
    case "session.ensureAgentWorkspace":
      attributes.projectId = intent.project.id;
      attributes.worktreeId = intent.worktree.id;
      attributes.sessionId = intent.sessionId;
      attributes.harnessProvider = intent.harness.provider;
      break;
    case "terminal.focus":
    case "terminal.close":
      if (intent.subject.projectId !== undefined) attributes.projectId = intent.subject.projectId;
      if (intent.subject.worktreeId !== undefined)
        attributes.worktreeId = intent.subject.worktreeId;
      if (intent.subject.sessionId !== undefined) attributes.sessionId = intent.subject.sessionId;
      break;
  }
  return attributes;
}

function timestamp(clock: RuntimeClock): string {
  return toIsoTimestamp(clock.now());
}

function cleanupTimeoutMs(commandTimeoutMs: number | undefined): number {
  return Math.min(commandTimeoutMs ?? 30_000, 5_000);
}
