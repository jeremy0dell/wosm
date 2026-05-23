import type { TmuxConfig } from "@wosm/config";
import type {
  OpenWorkspaceRequest,
  OpenWorkspaceResult,
  ProviderHealth,
  ProviderId,
  TerminalCapabilities,
  TerminalCapture,
  TerminalFocusContext,
  TerminalLaunchProcessRequest,
  TerminalLaunchProcessResult,
  TerminalProvider,
  TerminalTargetId,
  TerminalTargetObservation,
} from "@wosm/contracts";
import {
  type ExternalCommandRunner,
  type RuntimeClock,
  runExternalCommand,
  runRuntimeBoundaryWithRetryAndTimeout,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import { TmuxTerminalProviderError, tmuxProviderErrorFromUnknown } from "./errors.js";
import { renderHarnessLaunchCommand, resolveLaunchPaneTarget } from "./launch.js";
import { parseTmuxTargetLines, tmuxListTargetsFormat } from "./parse.js";
import {
  buildTmuxTargetId,
  buildWorkbenchWindowName,
  defaultTmuxWorkbenchSessionOptions,
  parseTmuxTargetId,
  resolveTmuxWorkbenchConfig,
  tmuxPrimaryPaneTarget,
  tmuxSessionOptionArgs,
  tmuxWindowTarget,
} from "./topology.js";

const tmuxPrimaryPaneIdentityFormat = ["#{session_name}", "#{window_id}", "#{pane_id}"].join("\t");

export type TmuxProviderOptions = {
  command?: string;
  config?: TmuxConfig;
  timeoutMs?: number;
  runner?: ExternalCommandRunner;
  clock?: RuntimeClock;
};

const tmuxCapabilities: TerminalCapabilities = {
  canOpenWorkspace: true,
  canFocusTarget: true,
  canCloseTarget: true,
  canCaptureOutput: true,
  canSendInput: true,
  canPersistIdentityBinding: true,
  canDisplayPopup: true,
};

export class TmuxProvider implements TerminalProvider {
  readonly id: ProviderId = "tmux";

  readonly #command: string;
  readonly #config: ReturnType<typeof resolveTmuxWorkbenchConfig>;
  readonly #timeoutMs: number;
  readonly #runner: ExternalCommandRunner | undefined;
  readonly #clock: RuntimeClock;

  constructor(options: TmuxProviderOptions = {}) {
    this.#command = options.command ?? process.env.WOSM_TMUX_BIN ?? "tmux";
    this.#config = resolveTmuxWorkbenchConfig(options.config);
    this.#timeoutMs = options.timeoutMs ?? 5000;
    this.#runner = options.runner;
    this.#clock = options.clock ?? systemClock;
  }

  capabilities(): TerminalCapabilities {
    return tmuxCapabilities;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = toIsoTimestamp(this.#clock.now());
    try {
      await this.#run(["-V"], {
        operation: "provider.tmux.health",
        fallback: {
          code: "TERMINAL_TMUX_UNAVAILABLE",
          message: "tmux is not available.",
        },
        retries: 1,
      });
      return {
        providerId: this.id,
        providerType: "terminal",
        status: "healthy",
        lastCheckedAt: checkedAt,
        capabilities: this.capabilities(),
      };
    } catch (cause) {
      return {
        providerId: this.id,
        providerType: "terminal",
        status: "unavailable",
        lastCheckedAt: checkedAt,
        lastError: tmuxProviderErrorFromUnknown(cause, {
          code: "TERMINAL_TMUX_UNAVAILABLE",
          message: "tmux is not available.",
          hint: "Install tmux or choose a different terminal provider.",
        }),
        capabilities: this.capabilities(),
      };
    }
  }

  async listTargets(): Promise<TerminalTargetObservation[]> {
    const output = await this.#run(["list-panes", "-a", "-F", tmuxListTargetsFormat], {
      operation: "provider.tmux.listTargets",
      fallback: {
        code: "TERMINAL_LIST_FAILED",
        message: "tmux failed to list terminal targets.",
      },
      retries: 1,
    });
    return parseTmuxTargetLines(output.stdout, {
      observedAt: toIsoTimestamp(this.#clock.now()),
    });
  }

  async openWorkspace(request: OpenWorkspaceRequest): Promise<OpenWorkspaceResult> {
    const sessionName = this.#config.workbenchSession;
    const windowName = buildWorkbenchWindowName({
      projectId: request.project.id,
      branch: request.worktree.branch,
    });
    const windowTarget = tmuxWindowTarget({ sessionId: sessionName, windowNameOrId: windowName });
    const paneTarget = tmuxPrimaryPaneTarget({
      sessionId: sessionName,
      windowNameOrId: windowName,
    });
    const sessionExists = await this.#hasSession(sessionName);

    if (sessionExists) {
      const windowExists = await this.#hasWindow(sessionName, windowName);
      if (!windowExists) {
        await this.#run(
          ["new-window", "-d", "-t", sessionName, "-n", windowName, "-c", request.worktree.path],
          {
            operation: "provider.tmux.openWorkspace",
            fallback: {
              code: "TERMINAL_OPEN_FAILED",
              message: "tmux failed to create a workbench window.",
            },
          },
        );
      }
    } else {
      await this.#run(
        ["new-session", "-d", "-s", sessionName, "-n", windowName, "-c", request.worktree.path],
        {
          operation: "provider.tmux.openWorkspace",
          fallback: {
            code: "TERMINAL_OPEN_FAILED",
            message: "tmux failed to create the workbench session.",
          },
        },
      );
    }

    await this.#configureWorkbenchSession(sessionName);

    // Write identity into tmux options so listTargets can correlate panes back to wosm state.
    await this.#setWindowOption(windowTarget, "@wosm.session_id", request.sessionId ?? "");
    await this.#setWindowOption(windowTarget, "@wosm.project_id", request.project.id);
    await this.#setWindowOption(windowTarget, "@wosm.worktree_id", request.worktree.id);
    await this.#setWindowOption(windowTarget, "@wosm.worktree_path", request.worktree.path);
    await this.#setPaneOption(paneTarget, "@wosm.role", "main-agent");
    await this.#setPaneOption(paneTarget, "@wosm.harness", request.harness);

    const primaryPane = await this.#resolvePrimaryPaneIdentity(paneTarget);
    return {
      target: {
        provider: this.id,
        targetId: buildTmuxTargetId(primaryPane),
        projectId: request.project.id,
        worktreeId: request.worktree.id,
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        providerData: {
          sessionName,
          windowName,
          windowTarget,
          paneTarget,
          windowId: primaryPane.windowId,
          paneId: primaryPane.paneId,
        },
        confidence: "high",
        reason: "tmux workbench workspace is open and identity binding was written.",
      },
      agentEndpointId: primaryPane.paneId,
      providerData: {
        sessionName,
        windowName,
        windowTarget,
        paneTarget,
        windowId: primaryPane.windowId,
        paneId: primaryPane.paneId,
      },
    };
  }

  async launchProcess(request: TerminalLaunchProcessRequest): Promise<TerminalLaunchProcessResult> {
    const paneTarget = resolveLaunchPaneTarget(request);
    await this.#run(
      ["send-keys", "-t", paneTarget, renderHarnessLaunchCommand(request.launchPlan), "C-m"],
      {
        operation: "provider.tmux.launchProcess",
        fallback: {
          code: "TERMINAL_LAUNCH_FAILED",
          message: "tmux failed to launch the harness process.",
        },
      },
    );
    return {
      terminalTargetId: request.terminalTarget.targetId,
      agentEndpointId: request.agentEndpointId,
      started: true,
      providerData: {
        paneTarget,
      },
    };
  }

  async focusTarget(targetId: TerminalTargetId, context?: TerminalFocusContext): Promise<void> {
    const target = parseTargetId(targetId);
    if (context?.origin?.provider === this.id && context.origin.clientId !== undefined) {
      await this.#run(["switch-client", "-c", context.origin.clientId, "-t", target.sessionId], {
        operation: "provider.tmux.focusTarget",
        fallback: {
          code: "TERMINAL_FOCUS_FAILED",
          message: "tmux failed to focus the originating client.",
        },
      });
    }
    await this.#run(
      [
        "select-window",
        "-t",
        tmuxWindowTarget({
          sessionId: target.sessionId,
          windowNameOrId: target.windowId,
        }),
      ],
      {
        operation: "provider.tmux.focusTarget",
        fallback: {
          code: "TERMINAL_FOCUS_FAILED",
          message: "tmux failed to focus the workbench window.",
        },
      },
    );
    await this.#run(["select-pane", "-t", target.paneId], {
      operation: "provider.tmux.focusTarget",
      fallback: {
        code: "TERMINAL_FOCUS_FAILED",
        message: "tmux failed to focus the primary pane.",
      },
    });
  }

  async closeTarget(targetId: TerminalTargetId): Promise<void> {
    const target = parseTargetId(targetId);
    await this.#run(
      [
        "kill-window",
        "-t",
        tmuxWindowTarget({
          sessionId: target.sessionId,
          windowNameOrId: target.windowId,
        }),
      ],
      {
        operation: "provider.tmux.closeTarget",
        fallback: {
          code: "TERMINAL_CLOSE_FAILED",
          message: "tmux failed to close the workbench window.",
        },
      },
    );
  }

  async captureTarget(targetId: TerminalTargetId): Promise<TerminalCapture> {
    const target = parseTargetId(targetId);
    const output = await this.#run(["capture-pane", "-p", "-t", target.paneId, "-S", "-80"], {
      operation: "provider.tmux.captureTarget",
      fallback: {
        code: "TERMINAL_CAPTURE_FAILED",
        message: "tmux failed to capture pane output.",
      },
    });
    return {
      targetId,
      capturedAt: toIsoTimestamp(this.#clock.now()),
      text: output.stdout,
      providerData: {
        sessionId: target.sessionId,
        windowId: target.windowId,
        paneId: target.paneId,
      },
    };
  }

  async sendInput(targetId: TerminalTargetId, input: string): Promise<void> {
    const target = parseTargetId(targetId);
    await this.#run(["send-keys", "-t", target.paneId, input], {
      operation: "provider.tmux.sendInput",
      fallback: {
        code: "TERMINAL_SEND_INPUT_FAILED",
        message: "tmux failed to send input to the pane.",
      },
    });
  }

  async #hasSession(sessionName: string): Promise<boolean> {
    try {
      await this.#run(["has-session", "-t", sessionName], {
        operation: "provider.tmux.hasSession",
        fallback: {
          code: "TERMINAL_TMUX_UNAVAILABLE",
          message: "tmux failed to inspect the workbench session.",
        },
        mapErrors: false,
      });
      return true;
    } catch {
      return false;
    }
  }

  async #hasWindow(sessionName: string, windowName: string): Promise<boolean> {
    try {
      const output = await this.#run(["list-windows", "-t", sessionName, "-F", "#{window_name}"], {
        operation: "provider.tmux.hasWindow",
        fallback: {
          code: "TERMINAL_LIST_FAILED",
          message: "tmux failed to inspect workbench windows.",
        },
        mapErrors: false,
      });
      return output.stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .includes(windowName);
    } catch {
      return false;
    }
  }

  async #configureWorkbenchSession(sessionName: string): Promise<void> {
    for (const option of defaultTmuxWorkbenchSessionOptions) {
      await this.#run(tmuxSessionOptionArgs(sessionName, option), {
        operation: "provider.tmux.configureWorkbench",
        fallback: {
          code: "TERMINAL_OPEN_FAILED",
          message: "tmux failed to configure the workbench session.",
        },
      });
    }
  }

  async #setWindowOption(target: string, name: string, value: string): Promise<void> {
    await this.#run(["set-option", "-w", "-t", target, name, value], {
      operation: "provider.tmux.openWorkspace",
      fallback: {
        code: "TERMINAL_OPEN_FAILED",
        message: "tmux failed to write window identity binding.",
      },
    });
  }

  async #setPaneOption(target: string, name: string, value: string): Promise<void> {
    await this.#run(["set-option", "-p", "-t", target, name, value], {
      operation: "provider.tmux.openWorkspace",
      fallback: {
        code: "TERMINAL_OPEN_FAILED",
        message: "tmux failed to write pane identity binding.",
      },
    });
  }

  async #resolvePrimaryPaneIdentity(paneTarget: string): Promise<{
    sessionId: string;
    windowId: string;
    paneId: string;
  }> {
    const output = await this.#run(
      ["display-message", "-p", "-t", paneTarget, tmuxPrimaryPaneIdentityFormat],
      {
        operation: "provider.tmux.openWorkspace",
        fallback: {
          code: "TERMINAL_OPEN_FAILED",
          message: "tmux failed to resolve the primary pane identity.",
        },
      },
    );
    const [sessionId = "", windowId = "", paneId = ""] = output.stdout.trim().split("\t");
    if (sessionId.length === 0 || windowId.length === 0 || paneId.length === 0) {
      throw new TmuxTerminalProviderError(
        "TERMINAL_OPEN_FAILED",
        "tmux returned an invalid primary pane identity.",
      );
    }
    return { sessionId, windowId, paneId };
  }

  async #run(
    args: string[],
    options: {
      operation: string;
      fallback: {
        code:
          | "TERMINAL_CAPTURE_FAILED"
          | "TERMINAL_CLOSE_FAILED"
          | "TERMINAL_FOCUS_FAILED"
          | "TERMINAL_LAUNCH_FAILED"
          | "TERMINAL_LIST_FAILED"
          | "TERMINAL_OPEN_FAILED"
          | "TERMINAL_SEND_INPUT_FAILED"
          | "TERMINAL_TMUX_UNAVAILABLE";
        message: string;
        hint?: string;
      };
      retries?: number;
      mapErrors?: boolean;
    },
  ) {
    const result = await runRuntimeBoundaryWithRetryAndTimeout(
      {
        operation: options.operation,
        clock: this.#clock,
        timeoutMs: this.#timeoutMs,
        error: {
          tag: "TerminalProviderError",
          code: options.fallback.code,
          message: options.fallback.message,
          provider: this.id,
          ...(options.fallback.hint === undefined ? {} : { hint: options.fallback.hint }),
        },
        timeoutError: {
          tag: "TerminalProviderError",
          code: "TERMINAL_TMUX_TIMEOUT",
          message: "tmux command timed out.",
          provider: this.id,
        },
        retry: {
          retries: options.retries ?? 0,
          delayMs: 10,
          shouldRetry: (error) => error.code !== "TERMINAL_TMUX_TIMEOUT",
        },
      },
      ({ signal }) =>
        runExternalCommand(
          {
            command: this.#command,
            args,
            signal,
            maxOutputChars: 512 * 1024,
          },
          this.#runner,
        ),
    );

    if (result.ok) {
      return result.value;
    }

    if (options.mapErrors === false) {
      throw result.error;
    }
    throw tmuxProviderErrorFromUnknown(result.error, options.fallback);
  }
}

function parseTargetId(targetId: TerminalTargetId): {
  sessionId: string;
  windowId: string;
  paneId: string;
} {
  try {
    return parseTmuxTargetId(targetId);
  } catch (cause) {
    throw new TmuxTerminalProviderError(
      "TERMINAL_TARGET_INVALID",
      "The terminal target id is not a valid tmux target.",
      { cause },
    );
  }
}
