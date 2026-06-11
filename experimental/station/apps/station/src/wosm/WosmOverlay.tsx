import type { WosmSnapshot } from "@wosm/contracts";
import type { StationWosmStateSource } from "../sources/types.js";
import { presentConnection } from "./connectionLabel.js";
import { useStationWosmState } from "./useStationWosmState.js";

const MAX_VISIBLE_ROWS = 16;
const MAX_VISIBLE_SESSIONS = 8;
const MAX_VISIBLE_ALERTS = 3;

/**
 * Read-only WOSM mode: projects, worktrees, sessions, and agent statuses from
 * the snapshot, with a calm connection line. No selection, no commands, no
 * PTY panes — those arrive in later PRs.
 */
export function WosmOverlay({ source }: { source: StationWosmStateSource }) {
  const { snapshot, connection } = useStationWosmState(source);
  const presentation = presentConnection(connection);

  return (
    <box width="100%" flexGrow={1} border title="wosm" padding={1} flexDirection="column">
      <text fg={presentation.color}>{` ${presentation.label} `}</text>
      {snapshot === undefined ? (
        <text fg="#9ca3af"> waiting for the first observer snapshot… </text>
      ) : (
        <SnapshotBody snapshot={snapshot} />
      )}
    </box>
  );
}

function SnapshotBody({ snapshot }: { snapshot: WosmSnapshot }) {
  return (
    <box width="100%" flexDirection="column">
      <text fg="#d4d4d8">{countsLine(snapshot)}</text>
      <text fg="#a1a1aa">{projectsLine(snapshot)}</text>
      <text fg="#71717a"> worktrees </text>
      {snapshot.rows.slice(0, MAX_VISIBLE_ROWS).map((row) => (
        <text key={row.id} fg={row.display.alert ? "#fbbf24" : "#d4d4d8"}>
          {worktreeLine(row)}
        </text>
      ))}
      {snapshot.rows.length > MAX_VISIBLE_ROWS ? (
        <text fg="#71717a">{`  +${snapshot.rows.length - MAX_VISIBLE_ROWS} more worktrees`}</text>
      ) : null}
      <text fg="#71717a"> sessions </text>
      {snapshot.sessions.length === 0 ? (
        <text fg="#52525b">{"  none"}</text>
      ) : (
        snapshot.sessions.slice(0, MAX_VISIBLE_SESSIONS).map((session) => (
          <text key={session.id} fg="#d4d4d8">
            {sessionLine(session)}
          </text>
        ))
      )}
      {/* Alert messages render verbatim, so data describes itself — the mock
          fixture's own alert is what tells a human they are looking at a
          static snapshot, without any code knowing the source. */}
      {snapshot.alerts.length > 0 ? <text fg="#71717a"> alerts </text> : null}
      {snapshot.alerts.slice(0, MAX_VISIBLE_ALERTS).map((alert) => (
        <text key={alert.id} fg="#fbbf24">
          {`  ${alert.message}`}
        </text>
      ))}
      {snapshot.alerts.length > MAX_VISIBLE_ALERTS ? (
        <text fg="#71717a">{`  +${snapshot.alerts.length - MAX_VISIBLE_ALERTS} more alerts`}</text>
      ) : null}
    </box>
  );
}

function countsLine(snapshot: WosmSnapshot): string {
  const { counts } = snapshot;
  return ` ${counts.projects} projects · ${counts.worktrees} worktrees · ${counts.agents} agents (${counts.working} working, ${counts.idle} idle, ${counts.attention} attention)`;
}

function projectsLine(snapshot: WosmSnapshot): string {
  if (snapshot.projects.length === 0) {
    return " no projects";
  }
  const labels = snapshot.projects
    .map((project) => `${project.label} (${project.counts.worktrees})`)
    .join(", ");
  return ` projects: ${labels}`;
}

function worktreeLine(row: WosmSnapshot["rows"][number]): string {
  const agent = row.agent === undefined ? "no agent" : `${row.agent.harness} ${row.agent.state}`;
  return `  ${row.projectLabel}/${row.branch} — ${row.display.statusLabel} — ${agent}`;
}

function sessionLine(session: WosmSnapshot["sessions"][number]): string {
  return `  ${session.title} — ${session.harness.provider} ${session.harness.mode} — ${session.terminal.state}`;
}
