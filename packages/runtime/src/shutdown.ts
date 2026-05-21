import {
  type RuntimeCancellationError,
  type RuntimeSafeError,
  safeErrorFromUnknown,
} from "./errors.js";

export type CancellationToken = {
  readonly aborted: boolean;
  readonly reason: RuntimeCancellationError | undefined;
  throwIfAborted(): void;
  onCancel(listener: (reason: RuntimeCancellationError) => void): () => void;
};

export type CancellationController = {
  readonly token: CancellationToken;
  cancel(reason?: Partial<RuntimeCancellationError>): void;
};

export function createCancellationController(): CancellationController {
  let aborted = false;
  let reason: RuntimeCancellationError | undefined;
  const listeners = new Set<(reason: RuntimeCancellationError) => void>();

  const token: CancellationToken = {
    get aborted() {
      return aborted;
    },
    get reason() {
      return reason;
    },
    throwIfAborted() {
      if (reason !== undefined) {
        throw reason;
      }
    },
    onCancel(listener) {
      listeners.add(listener);
      if (reason !== undefined) {
        listener(reason);
      }
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    token,
    cancel(input = {}) {
      if (aborted) {
        return;
      }
      aborted = true;
      reason = {
        tag: "CancellationError",
        code: input.code ?? "CANCELLED",
        message: input.message ?? "Operation was cancelled.",
        ...(input.hint === undefined ? {} : { hint: input.hint }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
      };
      for (const listener of listeners) {
        listener(reason);
      }
    },
  };
}

export async function runWithCancellation<T>(
  token: CancellationToken,
  task: () => Promise<T>,
): Promise<T> {
  token.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const unsubscribe = token.onCancel((cancelReason) => {
      unsubscribe();
      reject(cancelReason);
    });

    task()
      .then((value) => {
        unsubscribe();
        resolve(value);
      })
      .catch((error) => {
        unsubscribe();
        reject(safeErrorFromUnknown(error, fallbackCancellationError()));
      });
  });
}

function fallbackCancellationError(): RuntimeSafeError {
  return {
    tag: "CancellationError",
    code: "CANCELLED",
    message: "Operation was cancelled.",
  };
}
