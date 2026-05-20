export type RuntimeBoundaryPlaceholder = {
  readonly phase: "0";
  readonly status: "placeholder";
  readonly boundary: "runtime";
};

export function createRuntimeBoundaryPlaceholder(): RuntimeBoundaryPlaceholder {
  return {
    phase: "0",
    status: "placeholder",
    boundary: "runtime",
  };
}
