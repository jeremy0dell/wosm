export const piSupportedEventNames = [
  "session_start",
  "session_shutdown",
  "agent_start",
  "agent_end",
  "turn_start",
  "tool_execution_start",
  "tool_execution_end",
  "message_end",
  "session_compact",
] as const;

export type PiSupportedEventName = (typeof piSupportedEventNames)[number];
