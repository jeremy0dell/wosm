import { isObserverConnectError, safeErrorToNotice, toSafeError } from "@wosm/client";
import { describe, expect, it } from "vitest";

describe("client SafeError mapping", () => {
  it("preserves user-safe diagnostics from protocol errors", () => {
    const safe = toSafeError({
      tag: "TerminalProviderError",
      code: "TERMINAL_TARGET_MISSING",
      message: "The terminal target for this worktree no longer exists.",
      hint: "Refresh the dashboard or reopen the worktree.",
      diagnosticId: "diag_terminal_missing",
      traceId: "trc_terminal_missing",
    });

    expect(safeErrorToNotice(safe)).toEqual({
      kind: "error",
      message: "The terminal target for this worktree no longer exists.",
      hint: "Refresh the dashboard or reopen the worktree.",
      diagnosticId: "diag_terminal_missing",
      traceId: "trc_terminal_missing",
    });
  });

  it("converts unknown failures without leaking stacks or raw provider payloads", () => {
    const error = new Error("secret stack with providerData token");
    error.stack = "raw stack\nproviderData: token";

    const safe = toSafeError(error);
    const notice = safeErrorToNotice(safe);

    expect(notice.message).toBe("The TUI could not complete the observer operation.");
    expect(JSON.stringify(notice)).not.toContain("providerData");
    expect(JSON.stringify(notice)).not.toContain("raw stack");
    expect(JSON.stringify(notice)).not.toContain("token");
  });

  it("recognizes wrapped observer connect errors and hides raw socket paths in notices", () => {
    const cause = {
      tag: "ProtocolError",
      code: "PROTOCOL_CONNECT_FAILED",
      message: "Could not connect to observer socket /tmp/wosm-test.sock.",
    };
    const error = new Error("wrapped");
    (error as Error & { cause?: unknown }).cause = cause;

    const safe = toSafeError(error);
    const notice = safeErrorToNotice(safe);

    expect(isObserverConnectError(safe)).toBe(true);
    expect(notice).toEqual({
      kind: "error",
      message: "Observer is reconnecting.",
      hint: "Try the command again when the observer is ready.",
    });
    expect(JSON.stringify(notice)).not.toContain("/tmp/wosm-test.sock");
  });
});
