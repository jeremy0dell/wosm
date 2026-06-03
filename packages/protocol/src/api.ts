import type {
  CommandId,
  CommandReceipt,
  CommandRecord,
  DiagnosticCollectionOptions,
  DiagnosticSnapshot,
  DoctorOptions,
  DoctorReport,
  EventFilter,
  HarnessEventReport,
  HarnessEventReportReceipt,
  ObserverHealth,
  ObserverStopReceipt,
  ProviderHookEvent,
  ProviderHookReceipt,
  ReconcileReceipt,
  WosmCommand,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";

export type ObserverApi = {
  health(): Promise<ObserverHealth>;
  stop(): Promise<ObserverStopReceipt>;
  getSnapshot(options?: { includeDebug?: boolean }): Promise<WosmSnapshot>;
  subscribe(filter?: EventFilter): AsyncIterable<WosmEvent>;
  dispatch(command: WosmCommand): Promise<CommandReceipt>;
  getCommand(commandId: CommandId): Promise<CommandRecord | undefined>;
  reconcile(reason?: string): Promise<ReconcileReceipt>;
  ingestProviderHookEvent(event: ProviderHookEvent): Promise<ProviderHookReceipt>;
  ingestHookEvent(event: ProviderHookEvent): Promise<ProviderHookReceipt>;
  reportHarnessEvent(report: HarnessEventReport): Promise<HarnessEventReportReceipt>;
  runDoctor(options?: DoctorOptions): Promise<DoctorReport>;
  collectDiagnostics(options?: DiagnosticCollectionOptions): Promise<DiagnosticSnapshot>;
};
