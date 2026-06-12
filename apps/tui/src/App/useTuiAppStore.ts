import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import type { TuiObserverService } from "@wosm/dashboard-core";
import { createTuiStore, type TuiStore, type TuiStoreOptions } from "@wosm/dashboard-core";
import { useMemo } from "react";
import type { StoreApi } from "zustand/vanilla";

export type UseTuiAppStoreOptions = {
  service: TuiObserverService;
  initialSnapshot: WosmSnapshot | undefined;
  exitOnFocusSuccess: boolean;
  focusOrigin: TerminalFocusOrigin | undefined;
  resolveFocusOrigin: (() => Promise<TerminalFocusOrigin | undefined>) | undefined;
  onFocusSuccess: (() => Promise<void>) | undefined;
  onDismiss: (() => Promise<void>) | undefined;
  persistentPopup: boolean;
  onExit: ((code: number) => void) | undefined;
};

export function useTuiAppStore(options: UseTuiAppStoreOptions): StoreApi<TuiStore> {
  const {
    service,
    initialSnapshot,
    exitOnFocusSuccess,
    focusOrigin,
    resolveFocusOrigin,
    onFocusSuccess,
    onDismiss,
    persistentPopup,
    onExit,
  } = options;

  return useMemo(
    () =>
      createTuiStore(
        buildTuiStoreOptions({
          service,
          initialSnapshot,
          exitOnFocusSuccess,
          focusOrigin,
          resolveFocusOrigin,
          onFocusSuccess,
          onDismiss,
          persistentPopup,
          onExit,
        }),
      ),
    [
      exitOnFocusSuccess,
      focusOrigin,
      initialSnapshot,
      onDismiss,
      onExit,
      onFocusSuccess,
      persistentPopup,
      resolveFocusOrigin,
      service,
    ],
  );
}

function buildTuiStoreOptions(options: UseTuiAppStoreOptions): TuiStoreOptions {
  const built: TuiStoreOptions = {
    service: options.service,
    exitOnFocusSuccess: options.exitOnFocusSuccess,
    persistentPopup: options.persistentPopup,
  };
  if (options.initialSnapshot !== undefined) {
    built.initialSnapshot = options.initialSnapshot;
  }
  if (options.focusOrigin !== undefined) {
    built.focusOrigin = options.focusOrigin;
  }
  if (options.resolveFocusOrigin !== undefined) {
    built.resolveFocusOrigin = options.resolveFocusOrigin;
  }
  if (options.onFocusSuccess !== undefined) {
    built.onFocusSuccess = options.onFocusSuccess;
  }
  if (options.onDismiss !== undefined) {
    built.onDismiss = options.onDismiss;
  }
  if (options.onExit !== undefined) {
    built.onExit = options.onExit;
  }
  return built;
}
