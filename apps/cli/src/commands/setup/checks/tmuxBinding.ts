import { join } from "node:path";
import type { SetupTmuxBindingFact } from "../model.js";
import type { SetupFileSystemReader } from "./config.js";

export const tmuxPopupBindingMarker = "# >>> wosm popup binding >>>";
export const tmuxPopupBindingEndMarker = "# <<< wosm popup binding <<<";
export const tmuxPopupBindingLine =
  "bind-key Space run-shell -b 'env WOSM_FOCUS_PROVIDER=tmux WOSM_FOCUS_CLIENT_ID=#{q:client_name} wosm-tmux-popup'";

export type CheckSetupTmuxBindingOptions = {
  homeDir: string;
  fs?: SetupFileSystemReader;
};

export function setupTmuxConfigPath(
  options: Pick<CheckSetupTmuxBindingOptions, "homeDir">,
): string {
  return join(options.homeDir, ".tmux.conf");
}

export async function checkSetupTmuxBinding(
  options: CheckSetupTmuxBindingOptions,
): Promise<SetupTmuxBindingFact> {
  const path = setupTmuxConfigPath(options);
  const fs = options.fs ?? nodeFsReader();
  try {
    const source = await fs.readFile(path);
    if (source.includes(tmuxPopupBindingMarker) || source.includes("wosm-tmux-popup")) {
      return {
        status: "ok",
        path,
        marker: tmuxPopupBindingMarker,
      };
    }
  } catch {
    return missingTmuxBinding(path);
  }
  return missingTmuxBinding(path);
}

export function tmuxPopupBindingBlock(): string {
  return [tmuxPopupBindingMarker, tmuxPopupBindingLine, tmuxPopupBindingEndMarker, ""].join("\n");
}

function missingTmuxBinding(path: string): SetupTmuxBindingFact {
  return {
    status: "missing",
    path,
    marker: tmuxPopupBindingMarker,
    message: "Optional tmux popup binding is not installed.",
  };
}

function nodeFsReader(): SetupFileSystemReader {
  return {
    async readFile(path) {
      const { readFile } = await import("node:fs/promises");
      return readFile(path, "utf8");
    },
  };
}
