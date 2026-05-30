import { describe, expect, it } from "vitest";
import { safeErrorToToast, toSafeError } from "./errors.js";

describe("TUI SafeError mapping", () => {
  it("preserves user-safe diagnostics from protocol errors", () => {
    const safe = toSafeError({
      tag: "TerminalProviderError",
      code: "TERMINAL_TARGET_MISSING",
      message: "The terminal target for this worktree no longer exists.",
      hint: "Refresh the dashboard or reopen the worktree.",
      diagnosticId: "diag_terminal_missing",
      traceId: "trc_terminal_missing",
    });

    expect(safeErrorToToast(safe)).toEqual({
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
    const toast = safeErrorToToast(safe);

    expect(toast.message).toBe("The TUI could not complete the observer operation.");
    expect(JSON.stringify(toast)).not.toContain("providerData");
    expect(JSON.stringify(toast)).not.toContain("raw stack");
    expect(JSON.stringify(toast)).not.toContain("token");
  });
});
