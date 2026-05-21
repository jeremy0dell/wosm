import { z } from "zod";
import { nonEmptyStringSchema } from "./shared.js";

export const WOSM_SCHEMA_VERSION = "0.3.0" as const;

const timestampSchema = z.string().datetime({ offset: true });

export const SchemaVersionSchema = z.literal(WOSM_SCHEMA_VERSION);

export const ProjectIdSchema = nonEmptyStringSchema;
export const WorktreeIdSchema = nonEmptyStringSchema;
export const SessionIdSchema = nonEmptyStringSchema;
export const TerminalTargetIdSchema = nonEmptyStringSchema;
export const HarnessRunIdSchema = nonEmptyStringSchema;
export const CommandIdSchema = nonEmptyStringSchema;
export const EventIdSchema = nonEmptyStringSchema;
export const ProviderIdSchema = nonEmptyStringSchema;
export const TimestampSchema = timestampSchema;

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type WorktreeId = z.infer<typeof WorktreeIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type TerminalTargetId = z.infer<typeof TerminalTargetIdSchema>;
export type HarnessRunId = z.infer<typeof HarnessRunIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type ProviderId = z.infer<typeof ProviderIdSchema>;
