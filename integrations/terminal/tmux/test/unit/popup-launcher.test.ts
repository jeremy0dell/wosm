import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const launcherPath = fileURLToPath(new URL("../../bin/wosm-popup", import.meta.url));

describe("tmux popup launcher", () => {
  it("attaches a registered persistent popup UI without entering the Node CLI", async () => {
    const fixture = await createFakeTmux();

    await expect(
      runLauncher([], {
        FAKE_TMUX_OWNER: `${process.pid}:test`,
        TMUX: "/tmp/tmux-501/default,123,0",
        TMUX_LOG: fixture.logPath,
        WOSM_TMUX_BIN: fixture.tmuxPath,
      }),
    ).resolves.toMatchObject({ code: 0 });

    expect(await readLog(fixture.logPath)).toEqual([
      "show-options -gqv @wosm_tui_dev_session_name",
      "show-options -gqv @wosm_tui_dev_command",
      "show-options -gqv @wosm_tui_dev_owner",
      "has-session -t _wosm-ui-dev",
      "show-options -t _wosm-ui-dev -qv @wosm_popup_ui_signature",
      "display-message -p #{client_name}",
      "show-options -gqv @wosm_popup_client",
      "set-option -gq @wosm_popup_client client_1",
      "set-option -gq @wosm_popup_focus_client client_1",
      expect.stringContaining(
        `display-popup -c client_1 -w 50% -h 50% -E env -u TMUX '${fixture.tmuxPath}' attach-session -t '_wosm-ui-dev'`,
      ),
      "show-options -gqv @wosm_popup_client",
      "show-options -gqv @wosm_popup_focus_client",
    ]);
  });

  it("accepts a tmux binding focus client even when TMUX is not exported", async () => {
    const fixture = await createFakeTmux();

    await expect(
      runLauncher([], {
        FAKE_TMUX_OWNER: `${process.pid}:test`,
        TMUX_LOG: fixture.logPath,
        WOSM_FOCUS_CLIENT_ID: "client_from_binding",
        WOSM_TMUX_BIN: fixture.tmuxPath,
      }),
    ).resolves.toMatchObject({ code: 0 });

    expect(await readLog(fixture.logPath)).toContain(
      "display-popup -c client_from_binding -w 50% -h 50% -E env -u TMUX " +
        `'${fixture.tmuxPath}' attach-session -t '_wosm-ui-dev'`,
    );
  });

  it("attaches a registered normal popup UI without entering the Node CLI", async () => {
    const fixture = await createFakeTmux();

    await expect(
      runLauncher([], {
        FAKE_FAST_POPUP_EXPECTED_SIGNATURE: "v1:node normal tui --popup --persistent",
        FAKE_FAST_POPUP_SESSION_NAME: "_wosm-ui",
        FAKE_TMUX_MISSING_DEV_REGISTRATION: "1",
        TMUX: "/tmp/tmux-501/default,123,0",
        TMUX_LOG: fixture.logPath,
        WOSM_TMUX_BIN: fixture.tmuxPath,
      }),
    ).resolves.toMatchObject({ code: 0 });

    expect(await readLog(fixture.logPath)).toEqual([
      "show-options -gqv @wosm_tui_dev_session_name",
      "show-options -gqv @wosm_tui_dev_command",
      "show-options -gqv @wosm_popup_ui_session_name",
      "show-options -gqv @wosm_popup_ui_expected_signature",
      "has-session -t _wosm-ui",
      "show-options -t _wosm-ui -qv @wosm_popup_ui_signature",
      "display-message -p #{client_name}",
      "show-options -gqv @wosm_popup_client",
      "set-option -gq @wosm_popup_client client_1",
      "set-option -gq @wosm_popup_focus_client client_1",
      expect.stringContaining(
        `display-popup -c client_1 -w 50% -h 50% -E env -u TMUX '${fixture.tmuxPath}' attach-session -t '_wosm-ui'`,
      ),
      "show-options -gqv @wosm_popup_client",
      "show-options -gqv @wosm_popup_focus_client",
    ]);
  });

  it("only claims bare wosm and explicit popup invocations", async () => {
    const fixture = await createFakeTmux();

    await expect(
      runLauncher(["snapshot"], {
        FAKE_TMUX_OWNER: `${process.pid}:test`,
        TMUX: "/tmp/tmux-501/default,123,0",
        TMUX_LOG: fixture.logPath,
        WOSM_TMUX_BIN: fixture.tmuxPath,
      }),
    ).resolves.toMatchObject({ code: 1 });

    await expect(readLog(fixture.logPath)).resolves.toEqual([]);
  });

  it("closes the current client popup when toggled from the same client", async () => {
    const fixture = await createFakeTmux();

    await expect(
      runLauncher(["popup"], {
        FAKE_ACTIVE_POPUP_CLIENT: "client_1",
        FAKE_TMUX_OWNER: `${process.pid}:test`,
        TMUX: "/tmp/tmux-501/default,123,0",
        TMUX_LOG: fixture.logPath,
        WOSM_TMUX_BIN: fixture.tmuxPath,
      }),
    ).resolves.toMatchObject({ code: 0 });

    expect(await readLog(fixture.logPath)).toEqual([
      "show-options -gqv @wosm_tui_dev_session_name",
      "show-options -gqv @wosm_tui_dev_command",
      "show-options -gqv @wosm_tui_dev_owner",
      "has-session -t _wosm-ui-dev",
      "show-options -t _wosm-ui-dev -qv @wosm_popup_ui_signature",
      "display-message -p #{client_name}",
      "show-options -gqv @wosm_popup_client",
      "display-popup -c client_1 -C",
      "show-options -gqv @wosm_popup_client",
      "set-option -gq -u @wosm_popup_client",
      "show-options -gqv @wosm_popup_focus_client",
    ]);
  });

  it("falls back to the normal popup command when registered metadata is missing", async () => {
    const fixture = await createFakeTmux();

    await expect(
      runLauncher([], {
        FAKE_TMUX_MISSING_REGISTRATION: "1",
        FAKE_TMUX_OWNER: `${process.pid}:test`,
        TMUX: "/tmp/tmux-501/default,123,0",
        TMUX_LOG: fixture.logPath,
        WOSM_POPUP_FALLBACK_COMMAND: "printf fallback",
        WOSM_TMUX_BIN: fixture.tmuxPath,
      }),
    ).resolves.toMatchObject({ code: 0, stdout: "fallback" });

    expect(await readLog(fixture.logPath)).toEqual([
      "show-options -gqv @wosm_tui_dev_session_name",
      "show-options -gqv @wosm_tui_dev_command",
      "show-options -gqv @wosm_popup_ui_session_name",
      "show-options -gqv @wosm_popup_ui_expected_signature",
    ]);
  });

  it("declines fallback when the launcher is only being probed", async () => {
    const fixture = await createFakeTmux();

    await expect(
      runLauncher([], {
        FAKE_TMUX_MISSING_REGISTRATION: "1",
        TMUX: "/tmp/tmux-501/default,123,0",
        TMUX_LOG: fixture.logPath,
        WOSM_FAST_POPUP_NO_FALLBACK: "1",
        WOSM_POPUP_FALLBACK_COMMAND: "printf fallback",
        WOSM_TMUX_BIN: fixture.tmuxPath,
      }),
    ).resolves.toMatchObject({ code: 1, stdout: "" });

    expect(await readLog(fixture.logPath)).toEqual([
      "show-options -gqv @wosm_tui_dev_session_name",
      "show-options -gqv @wosm_tui_dev_command",
      "show-options -gqv @wosm_popup_ui_session_name",
      "show-options -gqv @wosm_popup_ui_expected_signature",
    ]);
  });

  it("falls back when the registered popup session is gone", async () => {
    const fixture = await createFakeTmux();

    await expect(
      runLauncher([], {
        FAKE_TMUX_HAS_SESSION: "0",
        FAKE_TMUX_OWNER: `${process.pid}:test`,
        TMUX: "/tmp/tmux-501/default,123,0",
        TMUX_LOG: fixture.logPath,
        WOSM_POPUP_FALLBACK_COMMAND: "printf fallback",
        WOSM_TMUX_BIN: fixture.tmuxPath,
      }),
    ).resolves.toMatchObject({ code: 0, stdout: "fallback" });

    expect(await readLog(fixture.logPath)).toEqual([
      "show-options -gqv @wosm_tui_dev_session_name",
      "show-options -gqv @wosm_tui_dev_command",
      "show-options -gqv @wosm_tui_dev_owner",
      "has-session -t _wosm-ui-dev",
      "show-options -gqv @wosm_popup_ui_session_name",
      "show-options -gqv @wosm_popup_ui_expected_signature",
    ]);
  });

  it("falls back when the registered popup owner is stale", async () => {
    const fixture = await createFakeTmux();

    await expect(
      runLauncher([], {
        FAKE_TMUX_OWNER: "999999999:test",
        TMUX: "/tmp/tmux-501/default,123,0",
        TMUX_LOG: fixture.logPath,
        WOSM_POPUP_FALLBACK_COMMAND: "printf fallback",
        WOSM_TMUX_BIN: fixture.tmuxPath,
      }),
    ).resolves.toMatchObject({ code: 0, stdout: "fallback" });

    expect(await readLog(fixture.logPath)).toEqual([
      "show-options -gqv @wosm_tui_dev_session_name",
      "show-options -gqv @wosm_tui_dev_command",
      "show-options -gqv @wosm_tui_dev_owner",
      "show-options -gqv @wosm_popup_ui_session_name",
      "show-options -gqv @wosm_popup_ui_expected_signature",
    ]);
  });
});

async function createFakeTmux(): Promise<{ logPath: string; tmuxPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "wosm-tmux-popup-launcher-"));
  const tmuxPath = join(dir, "tmux");
  const logPath = join(dir, "tmux.log");
  await writeFile(logPath, "");
  await writeFile(
    tmuxPath,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$TMUX_LOG"
last=
for arg in "$@"; do
  last=$arg
done
case "$1" in
  show-options)
	case "$last" in
	  @wosm_tui_dev_session_name)
	    [ "\${FAKE_TMUX_MISSING_REGISTRATION:-}" = "1" ] || [ "\${FAKE_TMUX_MISSING_DEV_REGISTRATION:-}" = "1" ] || printf '%s\\n' '_wosm-ui-dev'
	    ;;
	  @wosm_tui_dev_command)
	    [ "\${FAKE_TMUX_MISSING_REGISTRATION:-}" = "1" ] || [ "\${FAKE_TMUX_MISSING_DEV_REGISTRATION:-}" = "1" ] || printf '%s\\n' 'node tui'
	    ;;
	  @wosm_tui_dev_owner) printf '%s\\n' "$FAKE_TMUX_OWNER" ;;
	  @wosm_popup_ui_session_name) printf '%s\\n' "\${FAKE_FAST_POPUP_SESSION_NAME:-}" ;;
	  @wosm_popup_ui_expected_signature) printf '%s\\n' "\${FAKE_FAST_POPUP_EXPECTED_SIGNATURE:-}" ;;
	  @wosm_popup_ui_signature) printf '%s\\n' "\${FAKE_SESSION_SIGNATURE:-\${FAKE_FAST_POPUP_EXPECTED_SIGNATURE:-v1:node tui}}" ;;
	  @wosm_popup_client) printf '%s\\n' "\${FAKE_ACTIVE_POPUP_CLIENT:-}" ;;
	  @wosm_popup_focus_client) printf '%s\\n' "\${FAKE_FOCUS_POPUP_CLIENT:-}" ;;
	esac
	;;
  has-session)
    [ "\${FAKE_TMUX_HAS_SESSION:-1}" = "1" ] || exit 1
    ;;
  display-message)
    printf '%s\\n' 'client_1'
    ;;
  display-popup)
    ;;
  set-option)
    ;;
esac
`,
  );
  await chmod(tmuxPath, 0o700);
  return { logPath, tmuxPath };
}

async function readLog(path: string): Promise<string[]> {
  const log = await readFile(path, "utf8");
  return log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runLauncher(
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  const child = spawn(launcherPath, args, {
    env: {
      PATH: process.env.PATH ?? "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}
