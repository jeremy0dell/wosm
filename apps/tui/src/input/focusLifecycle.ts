import type { TerminalFocusOrigin, WosmCommand } from "@wosm/contracts";
import type { ObserverDashboardState } from "../hooks/useObserverDashboard.js";
import { safeErrorToToast, toSafeError } from "../services/errors/errors.js";

export type FocusLifecyclePresence = {
  exitOnFocusSuccess: boolean;
  persistentPopup: boolean;
  resolveFocusOrigin?: () => Promise<TerminalFocusOrigin | undefined>;
  onFocusSuccess?: () => Promise<void>;
};

export type FocusLifecycleOptions = FocusLifecyclePresence & {
  focusOrigin?: TerminalFocusOrigin;
  onExit?: (code: number) => void;
};

export function shouldUseFocusLifecycle(
  command: WosmCommand,
  options: FocusLifecyclePresence,
): command is Extract<WosmCommand, { type: "terminal.focus" }> {
  return (
    command.type === "terminal.focus" &&
    (options.exitOnFocusSuccess ||
      options.persistentPopup ||
      options.resolveFocusOrigin !== undefined ||
      options.onFocusSuccess !== undefined)
  );
}

export function buildFocusLifecycleOptions(options: {
  exitOnFocusSuccess: boolean;
  focusOrigin: TerminalFocusOrigin | undefined;
  resolveFocusOrigin: (() => Promise<TerminalFocusOrigin | undefined>) | undefined;
  onFocusSuccess: (() => Promise<void>) | undefined;
  persistentPopup: boolean;
  onExit: ((code: number) => void) | undefined;
}): FocusLifecycleOptions {
  const built: FocusLifecycleOptions = {
    exitOnFocusSuccess: options.exitOnFocusSuccess,
    persistentPopup: options.persistentPopup,
  };
  if (options.focusOrigin !== undefined) {
    built.focusOrigin = options.focusOrigin;
  }
  if (options.resolveFocusOrigin !== undefined) {
    built.resolveFocusOrigin = options.resolveFocusOrigin;
  }
  if (options.onFocusSuccess !== undefined) {
    built.onFocusSuccess = options.onFocusSuccess;
  }
  if (options.onExit !== undefined) {
    built.onExit = options.onExit;
  }
  return built;
}

export async function dispatchFocusWithLifecycle(
  command: Extract<WosmCommand, { type: "terminal.focus" }>,
  dashboard: ObserverDashboardState,
  options: FocusLifecycleOptions,
): Promise<void> {
  let focusCommand: Extract<WosmCommand, { type: "terminal.focus" }>;
  try {
    focusCommand = await withResolvedFocusOrigin(command, options);
  } catch (error: unknown) {
    dashboard.addToast(safeErrorToToast(toSafeError(error)));
    return;
  }

  const waitsForCompletion =
    options.exitOnFocusSuccess || options.persistentPopup || options.onFocusSuccess !== undefined;
  if (!waitsForCompletion) {
    await dashboard.dispatchCommand(focusCommand);
    return;
  }

  const succeeded = await dashboard.dispatchCommandAndWaitForCompletion(focusCommand);
  if (!succeeded) {
    return;
  }

  if (options.onFocusSuccess !== undefined) {
    try {
      await options.onFocusSuccess();
    } catch (error: unknown) {
      dashboard.addToast(safeErrorToToast(toSafeError(error)));
    }
  }

  if (options.exitOnFocusSuccess && !options.persistentPopup) {
    options.onExit?.(0);
  }
}

export async function dismissPersistentPopup(
  onDismiss: () => Promise<void>,
  dashboard: ObserverDashboardState,
): Promise<void> {
  try {
    await onDismiss();
  } catch (error: unknown) {
    dashboard.addToast(safeErrorToToast(toSafeError(error)));
  }
}

async function withResolvedFocusOrigin(
  command: Extract<WosmCommand, { type: "terminal.focus" }>,
  options: Pick<FocusLifecycleOptions, "focusOrigin" | "resolveFocusOrigin">,
): Promise<Extract<WosmCommand, { type: "terminal.focus" }>> {
  let origin = options.focusOrigin;
  if (options.resolveFocusOrigin !== undefined) {
    const resolved = await options.resolveFocusOrigin();
    if (resolved !== undefined) {
      origin = resolved;
    }
  }
  if (origin === undefined) {
    return command;
  }
  return {
    type: "terminal.focus",
    payload: {
      ...command.payload,
      origin,
    },
  };
}
