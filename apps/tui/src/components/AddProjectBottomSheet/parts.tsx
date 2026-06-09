import { Box, Text } from "ink";
import { isValidElement, type ReactNode } from "react";
import { Throbber } from "../Throbber/Throbber.js";

export function LabelValue({
  width,
  label,
  value,
}: {
  width: number;
  label: string;
  value: string | ReactNode;
}) {
  const labelText = ` ${label.padEnd(15)} `;
  if (isValidElement(value)) {
    return (
      <Box width={width}>
        <Text dimColor>{labelText}</Text>
        {value}
      </Box>
    );
  }
  return (
    <Box width={width}>
      <Text dimColor>{labelText}</Text>
      <Text>{fit(String(value), Math.max(1, width - labelText.length))}</Text>
    </Box>
  );
}

export function Line({ width, children }: { width: number; children: string | ReactNode }) {
  if (isValidElement(children)) {
    return <Box width={width}>{children}</Box>;
  }
  return (
    <Box width={width}>
      <Text>{fit(String(children), width)}</Text>
    </Box>
  );
}

export function Fill({ count, width }: { count: number; width: number }) {
  const lines: ReactNode[] = [];
  for (let line = 0; line < count; line += 1) {
    lines.push(
      <Line key={`blank-line-${line}`} width={width}>
        {" "}
      </Line>,
    );
  }
  return <>{lines}</>;
}

export function Footer({ width, children }: { width: number; children: string }) {
  return (
    <Box width={width}>
      <Text dimColor>{fit(` ${children}`, width)}</Text>
    </Box>
  );
}

export function ProgressFooter({ width, children }: { width: number; children: string }) {
  const throbberWidth = 3;
  const labelText = ` ${children}`.slice(0, Math.max(0, width - throbberWidth));
  const fillWidth = Math.max(0, width - labelText.length - throbberWidth);
  return (
    <Box width={width}>
      <Text dimColor>{labelText}</Text>
      <Throbber variant="dots" />
      {fillWidth > 0 ? <Text dimColor>{" ".repeat(fillWidth)}</Text> : null}
    </Box>
  );
}

export function SectionLine({ width, children }: { width: number; children: string }) {
  return (
    <MessageLine width={width} tone="accent">
      {children}
    </MessageLine>
  );
}

export function MetaLine({ width, label, value }: { width: number; label: string; value: string }) {
  const labelText = ` ${label.padEnd(7)} `;
  return (
    <Box width={width}>
      <Text dimColor>{labelText}</Text>
      <Text>{fit(value, Math.max(1, width - labelText.length))}</Text>
    </Box>
  );
}

export function MessageLine({
  width,
  tone = "normal",
  children,
}: {
  width: number;
  tone?: "normal" | "muted" | "accent" | "success" | "danger" | "warning";
  children: string;
}) {
  const text = fit(` ${children}`, width);
  if (tone === "muted") {
    return (
      <Box width={width}>
        <Text dimColor>{text}</Text>
      </Box>
    );
  }
  if (tone === "accent") {
    return (
      <Box width={width}>
        <Text color="cyan">{text}</Text>
      </Box>
    );
  }
  if (tone === "success") {
    return (
      <Box width={width}>
        <Text color="green">{text}</Text>
      </Box>
    );
  }
  if (tone === "danger") {
    return (
      <Box width={width}>
        <Text color="red">{text}</Text>
      </Box>
    );
  }
  if (tone === "warning") {
    return (
      <Box width={width}>
        <Text color="yellow">{text}</Text>
      </Box>
    );
  }
  return (
    <Box width={width}>
      <Text>{text}</Text>
    </Box>
  );
}

export function PickerLine({
  width,
  selected,
  label,
  detail,
}: {
  width: number;
  selected: boolean;
  label: string;
  detail: string;
}) {
  const prefix = selected ? " > " : "   ";
  const detailText = detail.length === 0 ? "" : ` ${detail}`;
  const maxDetailWidth = Math.max(0, width - prefix.length - 10);
  const visibleDetail = fit(detailText, Math.min(detailText.length, maxDetailWidth));
  const labelWidth = Math.max(1, width - prefix.length - visibleDetail.length);
  const prefixNode = selected ? <Text color="cyan">{prefix}</Text> : <Text>{prefix}</Text>;
  const labelNode = selected ? (
    <Text color="cyan">{fit(label, labelWidth)}</Text>
  ) : (
    <Text>{fit(label, labelWidth)}</Text>
  );
  return (
    <Box width={width}>
      {prefixNode}
      {labelNode}
      {visibleDetail.length > 0 ? <Text dimColor>{visibleDetail}</Text> : null}
    </Box>
  );
}

function fit(value: string, width: number): string {
  return value.padEnd(width).slice(0, width);
}
