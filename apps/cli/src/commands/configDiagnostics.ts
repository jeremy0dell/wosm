import { dirname, join } from "node:path";
import { ConfigError } from "@wosm/config";
import type {
  DebugBundleManifest,
  DiagnosticSnapshot,
  DoctorReport,
  SafeError,
  WosmSnapshot,
} from "@wosm/contracts";
import { DiagnosticSnapshotSchema, DoctorReportSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { mergeRetentionPolicy, scanLocalStateUsage, writeDebugBundle } from "@wosm/observability";
import { runRuntimeBoundary, systemClock, toIsoTimestamp } from "@wosm/runtime";

export type InvalidConfigDiagnosticsInput = {
  error: ConfigError;
  configPath: string;
  now?: Date | undefined;
};

export type InvalidConfigDebugBundleResult = {
  bundlePath: string;
  manifest: DebugBundleManifest;
};

export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError;
}

export async function runInvalidConfigDoctor(
  input: InvalidConfigDiagnosticsInput,
): Promise<DoctorReport> {
  const snapshot = await invalidConfigSnapshot(input);
  const localState = requireLocalState(snapshot);
  const retention = requireRetention(snapshot);
  const safeError = configSafeError(input.error);
  const report: DoctorReport = {
    schemaVersion: WOSM_SCHEMA_VERSION,
    generatedAt: snapshot.collectedAt,
    status: "unavailable",
    checks: [
      {
        name: "config",
        status: "error",
        message: safeError.message,
        error: safeError,
      },
    ],
    observer: snapshot.observerHealth,
    config: requireConfigSummary(snapshot),
    providers: {},
    snapshot: snapshot.snapshot,
    logs: {
      paths: [],
      recent: [],
    },
    localState,
    retention,
    recentErrors: [safeError],
    debugBundle: {
      available: true,
      diagnosticsDir: invalidConfigDiagnosticsDir(input.configPath),
    },
  };
  return DoctorReportSchema.parse(report);
}

export async function runInvalidConfigDebugBundle(
  input: InvalidConfigDiagnosticsInput,
): Promise<InvalidConfigDebugBundleResult> {
  const snapshot = await invalidConfigSnapshot(input);
  const written = await runRuntimeBoundary(
    {
      operation: "cli.debugBundle.writeInvalidConfig",
      error: {
        tag: "DebugBundleError",
        code: "DEBUG_BUNDLE_WRITE_FAILED",
        message: "Debug bundle could not be written.",
      },
    },
    async () =>
      writeDebugBundle({
        diagnosticsDir: invalidConfigDiagnosticsDir(input.configPath),
        snapshot,
        ...(input.now === undefined ? {} : { now: input.now }),
      }),
  );
  if (!written.ok) {
    throw written.error;
  }
  const manifest = written.value;
  return {
    bundlePath: manifest.bundlePath,
    manifest,
  };
}

async function invalidConfigSnapshot(
  input: InvalidConfigDiagnosticsInput,
): Promise<DiagnosticSnapshot> {
  const now = toIsoTimestamp(input.now ?? systemClock.now());
  const safeError = configSafeError(input.error);
  const stateDir = invalidConfigStateDir(input.configPath);
  const retention = mergeRetentionPolicy();
  const localState = await scanLocalStateUsage(stateDir, retention);
  const snapshot: DiagnosticSnapshot = {
    schemaVersion: WOSM_SCHEMA_VERSION,
    collectedAt: now,
    observerHealth: {
      schemaVersion: WOSM_SCHEMA_VERSION,
      status: "unavailable",
      stateDir,
    },
    snapshot: emptySnapshot(now),
    providerHealth: {},
    commands: [],
    events: [],
    errors: [
      {
        id: "config-load",
        tag: safeError.tag,
        code: safeError.code,
        message: safeError.message,
        severity: "fatal",
        redacted: true,
        createdAt: now,
      },
    ],
    logs: [],
    configSummary: {
      configPath: input.configPath,
      projectCount: 0,
      diagnostics: [safeError],
    },
    localState,
    retention,
  };
  return DiagnosticSnapshotSchema.parse(snapshot);
}

function configSafeError(error: ConfigError): SafeError {
  const safeError = error.toSafeError();
  safeError.diagnosticId = "config-load";
  return safeError;
}

function emptySnapshot(now: string): WosmSnapshot {
  return {
    schemaVersion: WOSM_SCHEMA_VERSION,
    generatedAt: now,
    observer: {
      pid: process.pid,
      startedAt: now,
      version: "0.0.0",
      healthy: false,
    },
    providerHealth: {},
    projects: [],
    rows: [],
    sessions: [],
    counts: {
      projects: 0,
      worktrees: 0,
      agents: 0,
      working: 0,
      idle: 0,
      attention: 0,
      unknown: 0,
    },
    alerts: [
      {
        id: "config-load",
        severity: "error",
        message: "Wosm config could not be loaded.",
        code: "CONFIG_LOAD_FAILED",
        createdAt: now,
      },
    ],
  };
}

function invalidConfigStateDir(configPath: string): string {
  return join(dirname(configPath), ".wosm-invalid-config-state");
}

function invalidConfigDiagnosticsDir(configPath: string): string {
  return join(invalidConfigStateDir(configPath), "diagnostics");
}

function requireConfigSummary(
  snapshot: DiagnosticSnapshot,
): NonNullable<DiagnosticSnapshot["configSummary"]> {
  if (snapshot.configSummary === undefined) {
    throw new Error("Invalid config diagnostic snapshot is missing config summary.");
  }
  return snapshot.configSummary;
}

function requireLocalState(
  snapshot: DiagnosticSnapshot,
): NonNullable<DiagnosticSnapshot["localState"]> {
  if (snapshot.localState === undefined) {
    throw new Error("Invalid config diagnostic snapshot is missing local state.");
  }
  return snapshot.localState;
}

function requireRetention(
  snapshot: DiagnosticSnapshot,
): NonNullable<DiagnosticSnapshot["retention"]> {
  if (snapshot.retention === undefined) {
    throw new Error("Invalid config diagnostic snapshot is missing retention.");
  }
  return snapshot.retention;
}
