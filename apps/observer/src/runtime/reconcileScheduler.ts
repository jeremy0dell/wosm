import { Effect } from "@wosm/runtime";

export type ReconcileScheduler = {
  request(reason: string): void;
};

export type CreateReconcileSchedulerOptions = {
  reconcile(reason: string): Promise<unknown>;
  debounceMs?: number;
  onError?: (error: unknown) => Promise<void> | void;
};

const defaultDebounceMs = 100;

export function createReconcileScheduler(
  options: CreateReconcileSchedulerOptions,
): ReconcileScheduler {
  const debounceMs = options.debounceMs ?? defaultDebounceMs;
  let running = false;
  let timerScheduled = false;
  const queuedReasons: string[] = [];

  return {
    request: (reason) => {
      queuedReasons.push(reason);
      if (running || timerScheduled) {
        return;
      }
      scheduleFlush();
    },
  };

  function scheduleFlush(): void {
    timerScheduled = true;
    void sleep(debounceMs).then(
      () => {
        timerScheduled = false;
        void flush().catch((error: unknown) => reportError(error));
      },
      () => {
        timerScheduled = false;
      },
    );
  }

  async function flush(): Promise<void> {
    if (running) {
      return;
    }
    const reasons = queuedReasons.splice(0);
    if (reasons.length === 0) {
      return;
    }

    running = true;
    try {
      await options.reconcile(summarizeReasons(reasons));
    } finally {
      running = false;
      if (queuedReasons.length > 0 && !timerScheduled) {
        scheduleFlush();
      }
    }
  }

  function reportError(error: unknown): void {
    if (options.onError === undefined) {
      return;
    }
    void Promise.resolve(options.onError(error)).catch(() => undefined);
  }
}

function summarizeReasons(reasons: string[]): string {
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length === 1) {
    return uniqueReasons[0] ?? "scheduled";
  }
  if (uniqueReasons.every((reason) => reason.startsWith("hook:"))) {
    return `hook:batch(${reasons.length})`;
  }
  return `scheduled:batch(${reasons.length})`;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    await Promise.resolve();
    return;
  }
  await Effect.runPromise(Effect.sleep(`${ms} millis`));
}
