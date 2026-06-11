import { createObserverService } from "@wosm/client";
import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import { render } from "ink";
import type { ComponentProps } from "react";
import { App } from "./App/App.js";
import type { TuiObserverService, TuiRunResult } from "./services/types.js";
import { resolveTuiModeFromEnv, TuiModeProvider } from "./tuiMode.js";
import type { TopRowWidgetRuntimeDeps, TuiConfig } from "./widgets/types.js";

export type RunTuiOptions = {
  socketPath?: string;
  service?: TuiObserverService;
  initialSnapshot?: WosmSnapshot;
  tuiConfig?: TuiConfig;
  topRowWidgetDeps?: TopRowWidgetRuntimeDeps;
  exitOnFocusSuccess?: boolean;
  focusOrigin?: TerminalFocusOrigin;
  resolveFocusOrigin?: () => Promise<TerminalFocusOrigin | undefined>;
  onFocusSuccess?: () => Promise<void>;
  onDismiss?: () => Promise<void>;
  persistentPopup?: boolean;
};

export async function runTui(options: RunTuiOptions): Promise<TuiRunResult> {
  const service = options.service ?? createObserverServiceFromOptions(options);
  return runInkApp(options, service);
}

function createObserverServiceFromOptions(options: RunTuiOptions): TuiObserverService {
  if (options.socketPath === undefined) {
    throw new Error("runTui requires socketPath unless a service is provided.");
  }
  return createObserverService({ socketPath: options.socketPath });
}

function runInkApp(options: RunTuiOptions, service: TuiObserverService): Promise<TuiRunResult> {
  return new Promise<TuiRunResult>((resolve) => {
    const controller = createTuiRunController(resolve);
    const appProps = buildAppProps(options, service, controller.exit);
    controller.attach(renderTuiApp(appProps));
  });
}

type InkRenderInstance = ReturnType<typeof render>;

function createTuiRunController(resolve: (result: TuiRunResult) => void): {
  attach(instance: InkRenderInstance): void;
  exit(code: number): void;
} {
  let resolved = false;
  let instance: InkRenderInstance | undefined;

  return {
    attach: (nextInstance) => {
      instance = nextInstance;
    },
    exit: (code) => {
      // Ink can surface multiple exit paths; only the first one should unmount and resolve the CLI.
      if (resolved) return;
      resolved = true;
      instance?.unmount();
      resolve({ status: "exited", code });
    },
  };
}

function buildAppProps(
  options: RunTuiOptions,
  service: TuiObserverService,
  onExit: (code: number) => void,
): ComponentProps<typeof App> {
  const appProps: ComponentProps<typeof App> = {
    service,
    ...(options.initialSnapshot === undefined ? {} : { initialSnapshot: options.initialSnapshot }),
    ...(options.tuiConfig === undefined ? {} : { tuiConfig: options.tuiConfig }),
    ...(options.topRowWidgetDeps === undefined
      ? {}
      : { topRowWidgetDeps: options.topRowWidgetDeps }),
    exitOnFocusSuccess: options.exitOnFocusSuccess === true,
    persistentPopup: options.persistentPopup === true,
    onExit,
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
  return appProps;
}

function renderTuiApp(appProps: ComponentProps<typeof App>): InkRenderInstance {
  return render(
    <TuiModeProvider mode={resolveTuiModeFromEnv(process.env)}>
      <App {...appProps} />
    </TuiModeProvider>,
    { alternateScreen: true },
  );
}
