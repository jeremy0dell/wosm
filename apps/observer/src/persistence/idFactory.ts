import { randomUUID } from "node:crypto";
import type { ObserverIdFactory } from "./types";

export const defaultIdFactory: ObserverIdFactory = {
  commandId: () => `cmd_${randomUUID()}`,
  eventId: () => `evt_${randomUUID()}`,
  errorId: () => `err_${randomUUID()}`,
  observationId: () => `obs_${randomUUID()}`,
  breadcrumbId: () => `crumb_${randomUUID()}`,
};
