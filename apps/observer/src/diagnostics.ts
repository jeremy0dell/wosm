import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ConfigDiagnostic, WosmConfig } from "@wosm/config";
import type {
  DiagnosticCollectionOptions,
  DiagnosticSnapshot,
  DoctorOptions,
  DoctorReport,
  LogRecord,
  SafeError,
} from "@wosm/contracts";
import { DiagnosticSnapshotSchema, DoctorReportSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import {
  componentLogPath,
  mergeRetentionPolicy,
  readJsonlLog,
  scanLocalStateUsage,
} from "@wosm/observability";
import type { RuntimeClock } from "@wosm/runtime";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";
import { doctorWorktrunkHooks } from "@wosm/worktrunk";
import type { ObserverPersistence } from "./persistence/index.js";
import type { ObserverCore } from "./reconcile.js";

export type DiagnosticRuntimePaths = {
  stateDir: string;
  socketPath?: string;
  hookSpoolDir?: string;
  diagnosticsDir?: string;
  logPaths?: string[];
};

export type ObserverDiagnosticsDeps = {
  config: WosmConfig;
  configPath?: string;
  configDiagnostics?: ConfigDiagnostic[];
  core: ObserverCore;
  persistence: ObserverPersistence;
  paths: DiagnosticRuntimePaths;
  clock?: RuntimeClock;
};

export async function collectDiagnosticSnapshot(
  deps: ObserverDiagnosticsDeps,
  options: DiagnosticCollectionOptions = {},
): Promise<DiagnosticSnapshot> {
  const clock = deps.clock ?? systemClock;
  const collectedAt = toIsoTimestamp(clock.now());
  const observerHealth = {
    schemaVersion: WOSM_SCHEMA_VERSION,
    ...deps.core.getHealth(),
    pid: deps.core.getSnapshot().observer.pid,
    version: deps.core.getSnapshot().observer.version,
    ...(deps.paths.socketPath === undefined ? {} : { socketPath: deps.paths.socketPath }),
    stateDir: deps.paths.stateDir,
  };
  const snapshot = deps.core.getSnapshot();
  const commands = await deps.persistence.listCommands();
  const filteredCommands =
    options?.commandId === undefined
      ? commands
      : commands.filter((command) => command.id === options.commandId);
  const events = await deps.persistence.listEvents(
    options?.commandId === undefined ? {} : { commandId: options.commandId },
  );
  const commandErrors = await deps.persistence.listCommandErrors(options?.commandId);
  const policy = mergeRetentionPolicy(deps.config.observability?.retention);
  const localState = await scanLocalStateUsage(deps.paths.stateDir, policy);
  const logs =
    options?.includeLogs === false
      ? []
      : await readLogs(
          deps.paths.logPaths ?? [componentLogPath(deps.paths.stateDir, "observer")],
          options?.maxLogRecords ?? 500,
        );
  const hookSpool =
    deps.paths.hookSpoolDir === undefined
      ? undefined
      : await summarizeHookSpool(deps.paths.hookSpoolDir);

  return DiagnosticSnapshotSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    collectedAt,
    observerHealth,
    snapshot,
    providerHealth: snapshot.providerHealth,
    commands: filteredCommands.map((command) => ({
      id: command.id,
      type: command.type,
      command: command.command,
      status: command.status,
      createdAt: command.createdAt,
      ...(command.startedAt === undefined ? {} : { startedAt: command.startedAt }),
      ...(command.finishedAt === undefined ? {} : { finishedAt: command.finishedAt }),
      ...(command.traceId === undefined ? {} : { traceId: command.traceId }),
      ...(command.spanId === undefined ? {} : { spanId: command.spanId }),
      ...(command.error === undefined ? {} : { error: command.error }),
    })),
    events: events.map((event) => event.event),
    errors: commandErrors.map((error) => error.envelope),
    logs,
    configSummary: configSummary(deps),
    localState,
    retention: policy,
    ...(hookSpool === undefined ? {} : { hookSpool }),
  });
}

export async function runDoctor(
  deps: ObserverDiagnosticsDeps,
  _options: DoctorOptions = {},
): Promise<DoctorReport> {
  const clock = deps.clock ?? systemClock;
  const snapshot = await collectDiagnosticSnapshot(deps, {
    includeLogs: true,
    maxLogRecords: 50,
  });
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    error?: SafeError;
  }> = [
    {
      name: "observer",
      status: snapshot.observerHealth.status === "healthy" ? "ok" : "warn",
      message: `Observer is ${snapshot.observerHealth.status}.`,
    },
    {
      name: "config",
      status: snapshot.configSummary?.diagnostics.length === 0 ? "ok" : "warn",
      message: `${snapshot.configSummary?.projectCount ?? 0} project(s) configured.`,
    },
    {
      name: "sqlite",
      status: snapshot.observerHealth.sqlite?.status === "healthy" ? "ok" : "warn",
      message: `SQLite is ${snapshot.observerHealth.sqlite?.status ?? "unavailable"}.`,
      ...(snapshot.observerHealth.sqlite?.lastError === undefined
        ? {}
        : { error: snapshot.observerHealth.sqlite.lastError }),
    },
    {
      name: "providers",
      status: providerStatus(snapshot) === "healthy" ? "ok" : "warn",
      message: `${Object.keys(snapshot.providerHealth).length} provider(s) reported health.`,
    },
    ...(await worktrunkHookChecks(deps)),
    {
      name: "retention",
      status: snapshot.localState?.overLimit === true ? "warn" : "ok",
      message: `Local state uses ${snapshot.localState?.totalBytes ?? 0} bytes.`,
    },
  ];
  const recentErrors = snapshot.errors.map((error) => errorToSafeError(error));
  const status = checks.some((check) => check.status === "error")
    ? "unavailable"
    : checks.some((check) => check.status === "warn") || recentErrors.length > 0
      ? "degraded"
      : "healthy";

  return DoctorReportSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    generatedAt: toIsoTimestamp(clock.now()),
    status,
    checks,
    observer: snapshot.observerHealth,
    config: snapshot.configSummary,
    ...(snapshot.observerHealth.sqlite === undefined
      ? {}
      : { sqlite: snapshot.observerHealth.sqlite }),
    providers: snapshot.providerHealth,
    ...(snapshot.hookSpool === undefined ? {} : { hooks: snapshot.hookSpool }),
    snapshot: snapshot.snapshot,
    logs: {
      paths: deps.paths.logPaths ?? [componentLogPath(deps.paths.stateDir, "observer")],
      recent: snapshot.logs,
    },
    localState: snapshot.localState,
    retention: snapshot.retention,
    recentErrors,
    debugBundle: {
      available: true,
      diagnosticsDir: deps.paths.diagnosticsDir ?? join(deps.paths.stateDir, "diagnostics"),
    },
  });
}

async function worktrunkHookChecks(deps: ObserverDiagnosticsDeps): Promise<
  Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    error?: SafeError;
  }>
> {
  if (deps.config.defaults.worktreeProvider !== "worktrunk") {
    return [];
  }

  const result = await doctorWorktrunkHooks({
    ...(deps.config.worktree?.worktrunk?.configPath === undefined
      ? {}
      : { worktrunkConfigPath: deps.config.worktree.worktrunk.configPath }),
    ...(deps.configPath === undefined ? {} : { wosmConfigPath: deps.configPath }),
    enabled: deps.config.worktree?.worktrunk?.useLifecycleHooks !== false,
  });

  return [
    {
      name: "worktrunk-hooks",
      status: result.status,
      message: `${result.message} Config: ${result.configPath}.`,
      ...(result.status === "ok"
        ? {}
        : {
            error: {
              tag: "WorktrunkHookSetupError",
              code: "WORKTRUNK_HOOKS_MISSING",
              message: result.message,
              provider: "worktrunk",
            },
          }),
    },
  ];
}

async function readLogs(paths: readonly string[], maxRecords: number): Promise<LogRecord[]> {
  const logs = await Promise.all(paths.map((path) => readJsonlLog(path, maxRecords)));
  return logs.flat().slice(-maxRecords);
}

function configSummary(deps: ObserverDiagnosticsDeps): DiagnosticSnapshot["configSummary"] {
  return {
    ...(deps.configPath === undefined ? {} : { configPath: deps.configPath }),
    projectCount: deps.config.projects.length,
    diagnostics: (deps.configDiagnostics ?? []).map((diagnostic) => ({
      tag: "ConfigError",
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.projectId === undefined ? {} : { projectId: diagnostic.projectId }),
    })),
  };
}

async function summarizeHookSpool(path: string): Promise<DiagnosticSnapshot["hookSpool"]> {
  const entries = await listFileStats(path);
  const created = entries.map((entry) => entry.mtime.toISOString()).sort();
  return {
    path,
    pending: entries.length,
    ...(created[0] === undefined ? {} : { oldestCreatedAt: created[0] }),
    ...(created.at(-1) === undefined ? {} : { newestCreatedAt: created.at(-1) }),
  };
}

async function listFileStats(path: string): Promise<Array<{ mtime: Date }>> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const fileStat = await stat(join(path, entry.name));
          return { mtime: fileStat.mtime };
        }),
    );
  } catch {
    return [];
  }
}

function providerStatus(snapshot: DiagnosticSnapshot): "healthy" | "degraded" {
  return Object.values(snapshot.providerHealth).some(
    (health) => health.status === "degraded" || health.status === "unavailable",
  )
    ? "degraded"
    : "healthy";
}

function errorToSafeError(error: DiagnosticSnapshot["errors"][number]): SafeError {
  return {
    tag: error.tag,
    code: error.code,
    message: error.message,
    ...(error.commandId === undefined ? {} : { commandId: error.commandId }),
    ...(error.projectId === undefined ? {} : { projectId: error.projectId }),
    ...(error.worktreeId === undefined ? {} : { worktreeId: error.worktreeId }),
    ...(error.sessionId === undefined ? {} : { sessionId: error.sessionId }),
    ...(error.provider === undefined ? {} : { provider: error.provider }),
    ...(error.traceId === undefined ? {} : { traceId: error.traceId }),
    diagnosticId: error.id,
  };
}
