import { describe, expect, it } from "vitest";
import { parseCleanupArgs } from "../../scripts/agent-cleanup.mjs";
import { isUnder, normalizeConfig, parseResetArgs } from "../../scripts/agent-reset.mjs";
import {
  commandFromArgs,
  defaultDevSessionNameForRoot,
  globalOptionsFromArgs,
  shouldKeepAliveAfterLauncherExit,
  shouldRunDirectTui,
} from "../../scripts/tui-dev.mjs";
import { shouldRestartForPath } from "../../scripts/tui-watch-runner.mjs";

describe("agent cleanup/reset scripts", () => {
  it("defaults cleanup and reset to dry-run mode", () => {
    expect(parseCleanupArgs([])).toMatchObject({
      dryRun: true,
      dogfood: true,
      localObserver: true,
      tmux: true,
    });
    expect(parseResetArgs([])).toMatchObject({
      dryRun: true,
      forceWorktrees: false,
      projectId: "wosm",
    });
  });

  it("parses explicit destructive reset flags", () => {
    expect(
      parseResetArgs(["--yes", "--force-worktrees", "--project-id", "protocol", "--state"]),
    ).toMatchObject({
      dryRun: false,
      forceWorktrees: true,
      projectId: "protocol",
      state: true,
    });
  });

  it("normalizes stale dogfood config without requiring a default Codex profile", () => {
    const input = `[harness.codex]
profile = "default"
sandbox = "workspace-write"

[worktree.worktrunk]
command = "wt"

[projects.worktrunk]
managed_root = ".worktrees"
include_external = false
`;

    const output = normalizeConfig(input);

    expect(output).toContain('managed_root = "~/.worktrees"');
    expect(output).toContain('sandbox = "workspace-write"');
    expect(output).not.toContain('profile = "default"');
    expect(output).not.toContain('managed_root = ".worktrees"');
    expect(output.indexOf('managed_root = "~/.worktrees"')).toBeLessThan(
      output.indexOf("[projects.worktrunk]"),
    );
  });

  it("adds a global managed root when the worktrunk section is missing", () => {
    expect(normalizeConfig("[projects]\n")).toContain(`[worktree.worktrunk]
managed_root = "~/.worktrees"`);
  });

  it("checks managed roots without prefix false positives", () => {
    expect(isUnder("/tmp/wosm/.worktrees/branch", "/tmp/wosm/.worktrees")).toBe(true);
    expect(isUnder("/tmp/wosm/.worktrees-other/branch", "/tmp/wosm/.worktrees")).toBe(false);
  });
});

describe("tui dev script", () => {
  it("keeps default tmux popup mode alive after the opener exits", () => {
    expect(commandFromArgs(["--config", "/tmp/wosm.toml"])).toBeUndefined();
    expect(globalOptionsFromArgs(["--config", "/tmp/wosm.toml", "popup"])).toEqual([
      "--config",
      "/tmp/wosm.toml",
    ]);
    expect(shouldRunDirectTui([], { TMUX: "/tmp/tmux-501/default,123,0" })).toBe(false);
    expect(shouldKeepAliveAfterLauncherExit([], { TMUX: "/tmp/tmux-501/default,123,0" })).toBe(
      true,
    );
    expect(
      shouldKeepAliveAfterLauncherExit(["--config", "/tmp/wosm.toml", "popup"], {
        TMUX: "/tmp/tmux-501/default,123,0",
      }),
    ).toBe(true);
  });

  it("uses a checkout-scoped default dev UI session name", () => {
    const main = defaultDevSessionNameForRoot("/Users/example/Developer/wosm");
    const worktree = defaultDevSessionNameForRoot("/Users/example/.worktrees/wosm/tui-layout");

    expect(main).toMatch(/^_wosm-ui-dev-wosm-[a-f0-9]{8}$/);
    expect(worktree).toMatch(/^_wosm-ui-dev-tui-layout-[a-f0-9]{8}$/);
    expect(main).not.toBe(worktree);
  });

  it("does not keep direct TUI or one-shot utility commands alive", () => {
    expect(shouldRunDirectTui([], {})).toBe(true);
    expect(shouldRunDirectTui(["tui"], { TMUX: "/tmp/tmux-501/default,123,0" })).toBe(true);
    expect(shouldKeepAliveAfterLauncherExit(["tui"], { TMUX: "/tmp/tmux-501/default,123,0" })).toBe(
      false,
    );
    expect(
      shouldKeepAliveAfterLauncherExit(["observer", "stop"], {
        TMUX: "/tmp/tmux-501/default,123,0",
      }),
    ).toBe(false);
  });

  it("restarts the dev TUI only for runtime dist files", () => {
    expect(shouldRestartForPath(undefined)).toBe(true);
    expect(shouldRestartForPath("/tmp/wosm/apps/tui/dist/App.js")).toBe(true);
    expect(shouldRestartForPath("/tmp/wosm/apps/tui/dist/package.json")).toBe(true);
    expect(shouldRestartForPath("/tmp/wosm/apps/tui/dist/App.d.ts")).toBe(false);
    expect(shouldRestartForPath("/tmp/wosm/apps/tui/dist/App.js.map")).toBe(false);
  });
});
