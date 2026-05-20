export type PhaseZeroConfig = {
  readonly phase: "0";
  readonly projects: readonly [];
  readonly source: "placeholder";
};

export function loadPhaseZeroConfig(): PhaseZeroConfig {
  return {
    phase: "0",
    projects: [],
    source: "placeholder",
  };
}
