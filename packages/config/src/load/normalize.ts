import type { ChildNormalizers, KeyMap, MutableRecord } from "./common";
import { isRecord } from "./common";

export function normalizeGlobalConfig(value: unknown): unknown {
  return normalizeObject(
    value,
    {
      schema_version: "schemaVersion",
    },
    {
      observer: normalizeObserverConfig,
      defaults: normalizeGlobalDefaults,
      worktree: normalizeWorktreeProvidersConfig,
      terminal: normalizeTerminalProvidersConfig,
      harness: normalizeHarnessProvidersConfig,
      projects: normalizeProjects,
    },
  );
}

export function normalizeProjectLocalConfig(value: unknown): unknown {
  return normalizeObject(
    value,
    {
      schema_version: "schemaVersion",
    },
    {
      defaults: normalizeProjectDefaults,
      commands: preserveRecordKeys,
      display: normalizeDisplayConfig,
    },
  );
}

function normalizeObserverConfig(value: unknown): unknown {
  return normalizeObject(value, {
    auto_start: "autoStart",
    auto_start_from_hooks: "autoStartFromHooks",
    idle_shutdown_minutes: "idleShutdownMinutes",
    reconcile_interval_ms: "reconcileIntervalMs",
    socket_path: "socketPath",
    state_dir: "stateDir",
  });
}

function normalizeGlobalDefaults(value: unknown): unknown {
  return normalizeObject(value, {
    worktree_provider: "worktreeProvider",
  });
}

function normalizeWorktreeProvidersConfig(value: unknown): unknown {
  return normalizeObject(value, {}, { worktrunk: normalizeWorktreeWorktrunkConfig });
}

function normalizeWorktreeWorktrunkConfig(value: unknown): unknown {
  return normalizeObject(value, {
    use_lifecycle_hooks: "useLifecycleHooks",
    hook_mode: "hookMode",
    breadcrumb_location: "breadcrumbLocation",
  });
}

function normalizeTerminalProvidersConfig(value: unknown): unknown {
  return normalizeObject(value, {}, { tmux: normalizeTmuxConfig });
}

function normalizeTmuxConfig(value: unknown): unknown {
  return normalizeObject(value, {
    session_prefix: "sessionPrefix",
    workbench_session: "workbenchSession",
    window_naming: "windowNaming",
    primary_agent_pane: "primaryAgentPane",
    popup_width: "popupWidth",
    popup_height: "popupHeight",
    popup_position: "popupPosition",
  });
}

function normalizeHarnessProvidersConfig(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([providerId, providerConfig]) => [
      providerId,
      normalizeHarnessProviderConfig(providerConfig),
    ]),
  );
}

function normalizeHarnessProviderConfig(value: unknown): unknown {
  return normalizeObject(value, {
    sandbox_mode: "sandboxMode",
    approval_policy: "approvalPolicy",
    install_hooks: "installHooks",
  });
}

function normalizeProjects(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map(normalizeProjectConfig);
}

function normalizeProjectConfig(value: unknown): unknown {
  return normalizeObject(
    value,
    {
      default_branch: "defaultBranch",
      local_config: "localConfig",
    },
    {
      defaults: normalizeProjectDefaults,
      worktrunk: normalizeProjectWorktrunkConfig,
      commands: preserveRecordKeys,
      env: preserveRecordKeys,
      display: normalizeDisplayConfig,
      localConfig: normalizeProjectLocalConfigRef,
      recoveryBreadcrumbs: normalizeProjectRecoveryBreadcrumbsConfig,
    },
  );
}

function normalizeProjectDefaults(value: unknown): unknown {
  return normalizeObject(value);
}

function normalizeProjectWorktrunkConfig(value: unknown): unknown {
  return normalizeObject(value);
}

function normalizeDisplayConfig(value: unknown): unknown {
  return normalizeObject(value, {
    sort_order: "sortOrder",
  });
}

function normalizeProjectLocalConfigRef(value: unknown): unknown {
  return normalizeObject(value);
}

function normalizeProjectRecoveryBreadcrumbsConfig(value: unknown): unknown {
  return normalizeObject(value);
}

function normalizeObject(
  value: unknown,
  keyMap: KeyMap = {},
  childNormalizers: ChildNormalizers = {},
): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: MutableRecord = {};

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = keyMap[key] ?? snakeToCamel(key);
    const childNormalizer = childNormalizers[normalizedKey];
    normalized[normalizedKey] =
      childNormalizer === undefined ? childValue : childNormalizer(childValue);
  }

  return normalized;
}

function preserveRecordKeys(value: unknown): unknown {
  return value;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
