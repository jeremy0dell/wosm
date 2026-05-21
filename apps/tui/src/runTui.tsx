import { render } from "ink";
import { App } from "./App.js";
import { createTuiObserverService } from "./services/observerService.js";
import type { TuiObserverService, TuiRunResult } from "./services/types.js";

export type RunTuiOptions = {
  socketPath: string;
  service?: TuiObserverService;
};

export async function runTui(options: RunTuiOptions): Promise<TuiRunResult> {
  const service = options.service ?? createTuiObserverService({ socketPath: options.socketPath });

  return new Promise<TuiRunResult>((resolve) => {
    let resolved = false;
    const instance = render(
      <App
        service={service}
        onExit={(code) => {
          if (resolved) return;
          resolved = true;
          instance.unmount();
          resolve({ status: "exited", code });
        }}
      />,
    );
  });
}
