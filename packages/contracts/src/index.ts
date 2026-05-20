export type PhaseZeroContractSurface = {
  readonly phase: "0";
  readonly status: "placeholder";
  readonly surfaces: readonly string[];
};

export const phaseZeroContracts: PhaseZeroContractSurface = {
  phase: "0",
  status: "placeholder",
  surfaces: ["snapshot", "commands", "events", "providers", "safe-errors"],
};
