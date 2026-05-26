import type { TerminalFocusOrigin } from "@wosm/contracts";
import { render } from "ink";
import type { ComponentProps } from "react";
import { App } from "./App.js";
import { createTuiObserverService } from "./services/observerService.js";
import type { TuiObserverService, TuiRunResult } from "./services/types.js";
import { resolveTuiModeFromEnv, TuiModeProvider } from "./tuiMode.js";

export type RunTuiOptions = {
  socketPath: string;
  service?: TuiObserverService;
  exitOnFocusSuccess?: boolean;
  focusOrigin?: TerminalFocusOrigin;
  resolveFocusOrigin?: () => Promise<TerminalFocusOrigin | undefined>;
  onFocusSuccess?: () => Promise<void>;
  onDismiss?: () => Promise<void>;
  persistentPopup?: boolean;
};

export async function runTui(options: RunTuiOptions): Promise<TuiRunResult> {
  const service = options.service ?? createTuiObserverService({ socketPath: options.socketPath });

  return new Promise<TuiRunResult>((resolve) => {
    let resolved = false;
    let instance: ReturnType<typeof render> | undefined;
    const appProps: ComponentProps<typeof App> = {
      service,
      exitOnFocusSuccess: options.exitOnFocusSuccess === true,
      persistentPopup: options.persistentPopup === true,
      onExit: (code) => {
        if (resolved) return;
        resolved = true;
        instance?.unmount();
        resolve({ status: "exited", code });
      },
    };
    if (options.focusOrigin !== undefined) {
      appProps.focusOrigin = options.focusOrigin;
    }
    if (options.resolveFocusOrigin !== undefined) {
      appProps.resolveFocusOrigin = options.resolveFocusOrigin;
    }
    if (options.onFocusSuccess !== undefined) {
      appProps.onFocusSuccess = options.onFocusSuccess;
    }
    if (options.onDismiss !== undefined) {
      appProps.onDismiss = options.onDismiss;
    }
    instance = render(
      <TuiModeProvider mode={resolveTuiModeFromEnv(process.env)}>
        <App {...appProps} />
      </TuiModeProvider>,
    );
  });
}
