import {
  type EventFilter,
  type WosmEvent,
  WosmEventTypeSchema,
  wosmEventCommandId,
  wosmEventTraceId,
} from "@wosm/contracts";
import type { ParsedObserveArgs, WosmEventType } from "./args.js";

const agentEventTypes: readonly WosmEventType[] = [
  "worktree.agentStateChanged",
  "session.created",
  "session.updated",
  "session.removed",
];

const failedEventTypes: readonly WosmEventType[] = ["command.failed", "provider.healthChanged"];

export function observeProtocolFilter(parsed: ParsedObserveArgs): EventFilter | undefined {
  const types = selectedProtocolTypes(parsed);
  const filter: EventFilter = {};
  if (types !== undefined) {
    filter.type = types.length === 1 ? types[0] : types;
  }
  if (parsed.traceId !== undefined) {
    filter.traceId = parsed.traceId;
  }
  if (parsed.commandId !== undefined) {
    filter.commandId = parsed.commandId;
  }
  return Object.keys(filter).length === 0 ? undefined : filter;
}

export function observeEventMatches(parsed: ParsedObserveArgs, event: WosmEvent): boolean {
  if (!eventMatchesCategorySelection(parsed, event)) {
    return false;
  }
  if (parsed.traceId !== undefined && wosmEventTraceId(event) !== parsed.traceId) {
    return false;
  }
  if (parsed.commandId !== undefined && wosmEventCommandId(event) !== parsed.commandId) {
    return false;
  }
  return true;
}

export function selectedProtocolTypes(parsed: ParsedObserveArgs): WosmEventType[] | undefined {
  if (!hasCategorySelector(parsed)) {
    return undefined;
  }

  const selected = new Set<WosmEventType>();
  for (const type of parsed.types) {
    selected.add(type);
  }
  if (parsed.agent) {
    for (const type of agentEventTypes) {
      selected.add(type);
    }
  }
  if (parsed.failed) {
    for (const type of failedEventTypes) {
      selected.add(type);
    }
  }

  return WosmEventTypeSchema.options.filter((type) => selected.has(type));
}

function hasCategorySelector(parsed: ParsedObserveArgs): boolean {
  return parsed.types.length > 0 || parsed.agent || parsed.failed;
}

function eventMatchesCategorySelection(parsed: ParsedObserveArgs, event: WosmEvent): boolean {
  if (!hasCategorySelector(parsed)) {
    return true;
  }
  if (parsed.types.includes(event.type)) {
    return true;
  }
  if (parsed.agent && agentEventTypes.includes(event.type)) {
    return true;
  }
  if (parsed.failed) {
    return eventMatchesFailedCategory(event);
  }
  return false;
}

function eventMatchesFailedCategory(event: WosmEvent): boolean {
  switch (event.type) {
    case "command.failed":
      return true;
    case "provider.healthChanged":
      return event.health.status !== "healthy";
    default:
      return false;
  }
}
