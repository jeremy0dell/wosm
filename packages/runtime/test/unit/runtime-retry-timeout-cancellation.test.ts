import {
  createCancellationController,
  runRuntimeBoundaryWithRetry,
  runRuntimeBoundaryWithTimeout,
  runWithCancellation,
} from "@wosm/runtime";
import { describe, expect, it } from "vitest";

const now = "2026-05-20T12:00:00.000Z";

describe("runtime retry, timeout, and cancellation helpers", () => {
  it("retries a failing boundary and preserves trace context", async () => {
    let attempts = 0;
    const result = await runRuntimeBoundaryWithRetry(
      {
        operation: "provider.fake.health",
        clock: { now: () => new Date(now) },
        error: {
          tag: "ProviderUnavailableError",
          code: "PROVIDER_FAILED",
          message: "Provider failed.",
        },
        retry: { retries: 2 },
        trace: { traceId: "trc_retry", spanId: "spn_retry" },
      },
      async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error("transient");
        }
        return "ok";
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: "ok",
      traceId: "trc_retry",
      spanId: "spn_retry",
    });
    expect(attempts).toBe(2);
  });

  it("maps timeout and cancellation to typed safe errors", async () => {
    const timeout = await runRuntimeBoundaryWithTimeout(
      {
        operation: "external.fake",
        timeoutMs: 1,
        error: {
          tag: "TimeoutError",
          code: "TIMEOUT_FAKE",
          message: "Fake operation timed out.",
        },
      },
      async () => new Promise((resolve) => setTimeout(resolve, 20)),
    );

    expect(timeout).toMatchObject({
      ok: false,
      error: {
        tag: "TimeoutError",
        code: "TIMEOUT_FAKE",
      },
    });

    const controller = createCancellationController();
    const cancelled = runWithCancellation(
      controller.token,
      async () => new Promise((resolve) => setTimeout(resolve, 20)),
    );
    controller.cancel({ code: "CANCELLED_TEST", message: "Test cancelled." });
    await expect(cancelled).rejects.toMatchObject({
      tag: "CancellationError",
      code: "CANCELLED_TEST",
    });
  });
});
