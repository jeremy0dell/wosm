export type StationSnapshot = Record<string, unknown>;

export interface StationSnapshotSource {
  getSnapshot(): Promise<StationSnapshot>;
}

export type StationSnapshotSourceName = "observer" | "mock";

export type StationSnapshotSourceConfig = {
  source: StationSnapshotSourceName;
};
