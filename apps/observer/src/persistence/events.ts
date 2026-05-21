import type { DatabaseSync } from "node:sqlite";
import type { CommandId, WosmEvent } from "@wosm/contracts";
import { WosmEventSchema } from "@wosm/contracts";
import { stringifyJson } from "./json.js";
import { type EventRow, eventFromRow } from "./rows.js";
import type { PersistedEvent } from "./types.js";

export function recordEvent(
  database: DatabaseSync,
  event: WosmEvent,
  options: {
    eventId: string;
    source: string;
    createdAt: string;
    commandId?: CommandId;
    traceId?: string;
    spanId?: string;
  },
): PersistedEvent {
  const parsedEvent = WosmEventSchema.parse(event);
  database
    .prepare(
      `
        INSERT INTO events (id, type, source, command_id, trace_id, span_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      options.eventId,
      parsedEvent.type,
      options.source,
      options.commandId ?? null,
      options.traceId ?? null,
      options.spanId ?? null,
      stringifyJson(parsedEvent),
      options.createdAt,
    );
  return readEvent(database, options.eventId);
}

export function listEvents(
  database: DatabaseSync,
  filter: {
    commandId?: CommandId;
    type?: WosmEvent["type"];
  } = {},
): PersistedEvent[] {
  return (database.prepare("SELECT * FROM events ORDER BY created_at, id").all() as EventRow[])
    .map(eventFromRow)
    .filter((event) => filter.commandId === undefined || event.commandId === filter.commandId)
    .filter((event) => filter.type === undefined || event.type === filter.type);
}

export function eventCommandId(event: WosmEvent): CommandId | undefined {
  return "commandId" in event ? event.commandId : undefined;
}

export function eventTimestamp(event: WosmEvent): string | undefined {
  return "at" in event ? event.at : undefined;
}

function readEvent(database: DatabaseSync, eventId: string): PersistedEvent {
  const row = database.prepare("SELECT * FROM events WHERE id = ?").get(eventId) as EventRow;
  return eventFromRow(row);
}
