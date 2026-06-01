import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@wosm/cli";
import { describe, expect, it } from "vitest";

describe("CLI event hook commands", () => {
  it("plans and installs the built-in turn completion notification hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-cli-event-hooks-"));
    const configPath = await writeConfig(root);

    const plan = await runCli([
      "--config",
      configPath,
      "hooks",
      "plan",
      "event",
      "notify-turn-completion",
    ]);

    expect(plan).toMatchObject({
      code: 0,
      output: {
        provider: "event",
        hookId: "notify-agent-idle",
        changed: true,
        installed: false,
      },
    });
    await expect(readFile(configPath, "utf8")).resolves.not.toContain("notify-agent-idle");

    await expect(
      runCli(["--config", configPath, "hooks", "install", "event", "notify-turn-completion"]),
    ).rejects.toThrow("without --yes");

    const install = await runCli([
      "--config",
      configPath,
      "hooks",
      "install",
      "event",
      "notify-turn-completion",
      "--yes",
    ]);

    expect(install).toMatchObject({
      code: 0,
      output: {
        provider: "event",
        installed: true,
      },
    });
    const after = await readFile(configPath, "utf8");
    expect(after).toContain('id = "notify-agent-idle"');
    expect(after).toContain('events = ["worktree.agentStateChanged"]');
    expect(after).toContain('args = ["notify", "turn-completion"]');

    const doctor = await runCli(["--config", configPath, "hooks", "doctor", "event"]);
    expect(doctor).toMatchObject({
      code: 0,
      output: {
        provider: "event",
        status: "ok",
        installed: true,
      },
    });
  });
});

async function writeConfig(root: string): Promise<string> {
  const configPath = join(root, "config.toml");
  await mkdir(join(root, "state"), { recursive: true });
  await writeFile(
    configPath,
    [
      "schema_version = 1",
      "projects = []",
      "",
      "[observer]",
      `socket_path = ${JSON.stringify(join(root, "run", "observer.sock"))}`,
      `state_dir = ${JSON.stringify(join(root, "state"))}`,
      "",
      "[defaults]",
      'worktree_provider = "worktrunk"',
      'terminal = "tmux"',
      'harness = "codex"',
      'layout = "agent-shell"',
      "",
    ].join("\n"),
    "utf8",
  );
  return configPath;
}
