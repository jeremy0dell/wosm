#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmux = process.env.WOSM_TMUX_BIN ?? "tmux";

const globalOptions = [
  "@wosm_popup_client",
  "@wosm_popup_focus_client",
  "@wosm_popup_ui_session_name",
  "@wosm_popup_ui_expected_signature",
  "@wosm_tui_dev_command",
  "@wosm_tui_dev_owner",
  "@wosm_tui_dev_root",
  "@wosm_tui_dev_session_name",
];

const sessions = ["_wosm-ui", defaultDevSessionNameForRoot(repoRoot)];

if (isInsideTmux(process.env) || process.env.WOSM_RESET_TMUX === "1") {
  for (const option of globalOptions) {
    spawnSync(tmux, ["set-option", "-gq", "-u", option], {
      cwd: repoRoot,
      stdio: "ignore",
      env: process.env,
    });
  }
  for (const session of sessions) {
    spawnSync(tmux, ["kill-session", "-t", session], {
      cwd: repoRoot,
      stdio: "ignore",
      env: process.env,
    });
  }
}

const restart = spawnSync("pnpm", ["wosm", "observer", "restart"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if ((restart.status ?? 1) !== 0) {
  process.exitCode = restart.status ?? 1;
  process.exit();
}

const result = spawnSync("pnpm", ["wosm"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

process.exitCode = result.status ?? 1;

function isInsideTmux(env) {
  return env.TMUX !== undefined && env.TMUX.length > 0;
}

function defaultDevSessionNameForRoot(root) {
  const slug = basename(root)
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 32);
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `_wosm-ui-dev-${slug.length === 0 ? "checkout" : slug}-${hash}`;
}
