export type ObserverHealthPlaceholder = {
  readonly phase: "0";
  readonly status: "ok";
  readonly behavior: "placeholder";
};

export function getObserverHealthPlaceholder(): ObserverHealthPlaceholder {
  return {
    phase: "0",
    status: "ok",
    behavior: "placeholder",
  };
}
