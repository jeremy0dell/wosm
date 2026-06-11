import {
  stripAnsiSequences,
} from "@opentui/core";
import {
  useTerminalDimensions,
} from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createNodePtyTerminal } from "./nodePtyTerminal.js";
import type {
  StationTerminalExit,
  StationTerminalProcess,
  StationTerminalSize,
} from "./types.js";
import { setStationTerminalInputTarget } from "./inputTarget.js";

const OUTPUT_LINE_LIMIT = 200;

export function TerminalPane() {
  const dimensions = useTerminalDimensions();
  const terminalRef = useRef<StationTerminalProcess | null>(null);
  const paneSize = useMemo(() => terminalSizeFromDimensions(dimensions), [dimensions]);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("starting shell");

  useEffect(() => {
    let terminal: StationTerminalProcess;
    try {
      terminal = createNodePtyTerminal({
        size: paneSize,
      });
    } catch (error) {
      setStatus("failed to start shell");
      setOutput(error instanceof Error ? error.message : "Failed to start shell.");
      return;
    }

    terminalRef.current = terminal;
    setStationTerminalInputTarget(terminal);
    setStatus(`pid ${terminal.pid}`);
    const dataSubscription = terminal.onData((data) => {
      setOutput((current) => appendTerminalOutput(current, data));
    });
    const exitSubscription = terminal.onExit((event) => {
      setStatus(formatExit(event));
    });

    return () => {
      dataSubscription.dispose();
      exitSubscription.dispose();
      terminal.dispose();
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
        setStationTerminalInputTarget(null);
      }
    };
  }, []);

  useEffect(() => {
    terminalRef.current?.resize(paneSize);
  }, [paneSize]);

  return (
    <box width="100%" flexGrow={1} border title={`terminal ${status}`} padding={1}>
      <text fg="#d4d4d8">{output || " "}</text>
    </box>
  );
}

function terminalSizeFromDimensions(dimensions: { width: number; height: number }): StationTerminalSize {
  return {
    cols: Math.max(20, dimensions.width - 4),
    rows: Math.max(4, dimensions.height - 4),
  };
}

function appendTerminalOutput(current: string, data: string): string {
  const sanitized = stripAnsiSequences(data)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = `${current}${sanitized}`.split("\n");

  if (lines.length <= OUTPUT_LINE_LIMIT) {
    return lines.join("\n");
  }

  return lines.slice(lines.length - OUTPUT_LINE_LIMIT).join("\n");
}

function formatExit(event: StationTerminalExit): string {
  if (event.signal !== undefined && event.signal !== 0) {
    return `exited ${event.exitCode} signal ${event.signal}`;
  }

  return `exited ${event.exitCode}`;
}
