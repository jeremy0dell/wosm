export type ProtocolSmokePlaceholder = {
  readonly phase: "0";
  readonly status: "placeholder";
  readonly contractSurfaceCount: number;
};

export function createProtocolSmokePlaceholder(): ProtocolSmokePlaceholder {
  return {
    phase: "0",
    status: "placeholder",
    contractSurfaceCount: 5,
  };
}
