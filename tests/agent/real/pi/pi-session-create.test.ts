import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { WosmConfig } from "@wosm/config";
import { writeDebugBundle } from "@wosm/observability";
import {
  collectDiagnosticSnapshot,
  createCommandQueue,
  createObserverCore,
  createObserverEventBus,
  createObserverPersistence,
  openObserverSqlite,
  ProviderRegistry,
  registerObserverCommandHandlers,
} from "@wosm/observer/internal";
import { PiHarnessProvider } from "@wosm/pi";
import { FakeWorktreeProvider } from "@wosm/testing";
import { TmuxProvider } from "@wosm/tmux";
import { afterEach, describe, expect, it } from "vitest";
import type { RealDogfoodEnvironment } from "../../../support/real-wosm/env";
import { createPiLaunchLoggingWrapper, waitForPiLaunchLog } from "../../../support/real-wosm/pi";

const execFileAsync = promisify(execFile);
const realPiEnabled = process.env.WOSM_REAL_PI === "1";
const describeRealPi = realPiEnabled ? describe : describe.skip;

const now = "2026-05-27T12:00:00.000Z";
let cleanupTasks: Array<() => Promise<void>> = [];

describeRealPi("real Pi session.create launch lane", () => {
  afterEach(async () => {
    const tasks = cleanupTasks;
    cleanupTasks = [];
    await Promise.allSettled(tasks.map((task) => task()));
  });

  it("launches Pi through tmux with the standalone WOSM extension", async () => {
    const piBin = process.env.WOSM_PI_BIN ?? "pi";
    const tmuxBin = process.env.WOSM_TMUX_BIN ?? "tmux";
    await execFileAsync(piBin, ["--version"], { timeout: 15_000 });
    await execFileAsync(tmuxBin, ["-V"], { timeout: 10_000 });

    const root = await mkdtemp(join(tmpdir(), "wosm-real-pi-"));
    const stateDir = join(root, "state");
    const diagnosticsDir = join(stateDir, "diagnostics");
    const worktreePath = join(root, "worktree");
    const configPath = join(root, "wosm.config.toml");
    const sessionName = `wosm-pi-${process.pid}-${Date.now()}`;
    await mkdir(stateDir, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: worktreePath, timeout: 10_000 });
    await writeFile(configPath, "# real Pi launch test config placeholder\n", "utf8");

    const env: RealDogfoodEnvironment = {
      repoRoot: process.cwd(),
      wosmBin: join(process.cwd(), "bin", "wosm"),
      wosmHookBin: join(process.cwd(), "bin", "wosm-hook"),
      tmuxBin,
      piBin,
    };
    const piWrapper = await createPiLaunchLoggingWrapper({
      env,
      root,
      execRealPi: false,
    });

    cleanupTasks.push(async () => {
      await execFileAsync(tmuxBin, ["kill-session", "-t", sessionName], {
        timeout: 10_000,
      }).catch(() => undefined);
    });
    if (process.env.WOSM_REAL_PI_KEEP_TEMP !== "1") {
      cleanupTasks.push(async () => {
        await rm(root, { recursive: true, force: true });
      });
    } else {
      process.stderr.write(`Keeping real Pi temp root: ${root}\n`);
    }

    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({ path: join(stateDir, "observer.sqlite"), clock });
    cleanupTasks.push(async () => sqlite.close());
    const idFactory = ids();
    const persistence = createObserverPersistence({ sqlite, clock, idFactory });
    const eventBus = createObserverEventBus();
    const queue = createCommandQueue({
      persistence,
      idFactory,
      clock,
      eventBus,
    });
    const testConfig = config(root, stateDir);
    const terminal = new TmuxProvider({
      command: tmuxBin,
      clock,
      config: {
        workbenchSession: sessionName,
      },
    });
    const providers = new ProviderRegistry({
      worktree: new FakeWorktreeProvider({
        now,
        createPath: () => worktreePath,
      }),
      terminal,
      harnesses: [
        new PiHarnessProvider({
          command: piWrapper.wrapperPath,
          configPath,
          now: () => new Date(now),
        }),
      ],
    });
    const core = createObserverCore({
      config: testConfig,
      providers,
      persistence,
      sqlite,
      clock,
      providerTimeoutMs: 20_000,
    });
    registerObserverCommandHandlers({
      queue,
      core,
      providers,
      projects: testConfig.projects,
      persistence,
      eventBus,
      clock,
      idFactory: {
        sessionId: () => "ses_real_pi",
      },
      commandTimeoutMs: 30_000,
    });

    try {
      const receipt = await queue.dispatch({
        type: "session.create",
        payload: {
          projectId: "web",
          branch: "pi-real",
          harness: {
            provider: "pi",
            mode: "interactive",
          },
          terminal: {
            provider: "tmux",
            layout: "agent-build-shell",
          },
        },
      });
      await queue.drain();
      const launchLog = await waitForPiLaunchLog(piWrapper, "arg=--extension");
      const snapshot = await pollForPiRow(core);

      expect(await persistence.getCommand(receipt.commandId)).toMatchObject({
        status: "succeeded",
      });
      expect(launchLog).toContain("env.WOSM_CONFIG_PATH=");
      expect(launchLog).toContain(configPath);
      expect(launchLog).toContain("env.WOSM_HARNESS_PROVIDER=pi");
      expect(launchLog).toContain("env.WOSM_SESSION_ID=ses_real_pi");
      const extensionPath = extensionPathFromLaunchLog(launchLog);
      expect(extensionPath).toMatch(/\/integrations\/harness\/pi\/dist\/piExtension\.js$/);
      await expect(access(extensionPath)).resolves.toBeUndefined();
      expect(snapshot.rows[0]?.agent).toMatchObject({
        harness: "pi",
        sessionId: "ses_real_pi",
        state: "unknown",
        confidence: "low",
      });
      expect(snapshot.sessions[0]).toMatchObject({
        id: "ses_real_pi",
        harness: {
          provider: "pi",
        },
      });
    } catch (error) {
      await writeFailureBundle({
        config: testConfig,
        core,
        persistence,
        stateDir,
        diagnosticsDir,
      });
      throw error;
    }
  }, 180_000);
});

function extensionPathFromLaunchLog(launchLog: string): string {
  const line = launchLog
    .split(/\r?\n/)
    .find((candidate) => candidate.endsWith("/integrations/harness/pi/dist/piExtension.js"));
  if (line === undefined) {
    throw new Error("Pi launch log did not include a dist/piExtension.js argument.");
  }
  return line.replace(/^arg=/, "");
}

async function pollForPiRow(core: ReturnType<typeof createObserverCore>) {
  return poll(async () => {
    const snapshot = await core.reconcile("pi-real-poll");
    return snapshot.rows[0]?.agent?.harness === "pi" ? snapshot : undefined;
  }, "Observer did not discover the real Pi session.");
}

async function poll<T>(probe: () => Promise<T | false | undefined>, message: string): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const value = await probe();
    if (value !== false && value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(message);
}

async function writeFailureBundle(input: {
  config: WosmConfig;
  core: ReturnType<typeof createObserverCore>;
  persistence: ReturnType<typeof createObserverPersistence>;
  stateDir: string;
  diagnosticsDir: string;
}): Promise<void> {
  const snapshot = await collectDiagnosticSnapshot({
    config: input.config,
    core: input.core,
    persistence: input.persistence,
    paths: {
      stateDir: input.stateDir,
      diagnosticsDir: input.diagnosticsDir,
    },
    clock: { now: () => new Date(now) },
  });
  await writeDebugBundle({
    diagnosticsDir: input.diagnosticsDir,
    snapshot,
    now: new Date(now),
    bundleId: "diag_real_pi_failure",
  });
}

function config(root: string, stateDir: string): WosmConfig {
  return {
    schemaVersion: 1,
    observer: {
      stateDir,
      socketPath: join(root, "observer.sock"),
    },
    defaults: {
      worktreeProvider: "fake-worktree",
      terminal: "tmux",
      harness: "pi",
      layout: "agent-shell",
    },
    terminal: {
      tmux: {},
    },
    harness: {
      pi: {
        enabled: true,
      },
    },
    projects: [
      {
        id: "web",
        label: "web",
        root,
        defaults: {
          harness: "pi",
          terminal: "tmux",
          layout: "agent-shell",
        },
        worktrunk: {
          enabled: true,
        },
      },
    ],
  };
}

function ids() {
  let command = 0;
  let event = 0;
  let error = 0;
  let observation = 0;
  let breadcrumb = 0;
  return {
    commandId: () => `cmd_${++command}`,
    eventId: () => `evt_${++event}`,
    errorId: () => `err_${++error}`,
    observationId: () => `obs_${++observation}`,
    breadcrumbId: () => `crumb_${++breadcrumb}`,
  };
}
