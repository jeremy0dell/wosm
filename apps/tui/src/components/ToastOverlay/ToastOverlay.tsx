import type { BoxProps } from "ink";
import { Box, Text } from "ink";
import type { TuiToastEntry } from "../../state/screen.js";
import { FloatingBlankBackground } from "../FloatingBlankBackground/FloatingBlankBackground.js";
import { truncateCells } from "../WorktreeRow/layout.js";
import { toastOverlayLayout } from "./layout.js";

export type ToastOverlayProps = {
  columns: number;
  rows: number;
  toast: TuiToastEntry | undefined;
  promptRows: number;
  hiddenByModal: boolean;
};

export function ToastOverlay({
  columns,
  rows,
  toast,
  promptRows,
  hiddenByModal,
}: ToastOverlayProps) {
  if (hiddenByModal || toast === undefined) {
    return null;
  }

  const detail = toastDetail(toast);
  const layout = toastOverlayLayout({
    columns,
    rows,
    promptRows,
    contentRows: detail === undefined ? 2 : 3,
  });
  if (layout === undefined) {
    return null;
  }
  const textWidth = toastTextWidth(layout.contentWidth);

  return (
    <>
      <FloatingBlankBackground
        left={layout.left}
        top={layout.top}
        width={Math.max(1, Math.max(1, columns) - layout.left)}
        height={layout.height}
      />
      <Box
        position="absolute"
        left={layout.left}
        top={layout.top}
        width={layout.width}
        height={layout.height}
        borderStyle="round"
        borderColor={toastBorderColor(toast)}
        flexDirection="column"
        overflow="hidden"
      >
        <Box flexDirection="column" paddingLeft={1} paddingRight={1} overflow="hidden">
          <Text bold wrap="truncate-end">
            {truncateCells(toastTitle(toast), textWidth)}
          </Text>
          <Text wrap="truncate-end">{truncateCells(toast.toast.message, textWidth)}</Text>
          {detail === undefined ? null : (
            <Text color="gray" wrap="truncate-end">
              {truncateCells(detail, textWidth)}
            </Text>
          )}
        </Box>
      </Box>
    </>
  );
}

export function toastDetail(entry: TuiToastEntry): string | undefined {
  const details: string[] = [];
  const { toast } = entry;
  if (toast.hint !== undefined) {
    details.push(toast.hint);
  }
  if (toast.traceId !== undefined) {
    details.push(`trace ${toast.traceId}`);
  }
  if (toast.diagnosticId !== undefined) {
    details.push(`diagnostic ${toast.diagnosticId}`);
  }
  return details.length === 0 ? undefined : details.join(" | ");
}

function toastTitle(entry: TuiToastEntry): string {
  if (entry.toast.kind === "error") {
    return "needs attention";
  }
  if (entry.toast.kind === "info") {
    return "notice";
  }
  return entry.toast.message === "Observer reconnected." ? "connected" : "saved";
}

function toastBorderColor(entry: TuiToastEntry): BoxProps["borderColor"] {
  if (entry.toast.kind === "error") {
    return "red";
  }
  if (entry.toast.kind === "info") {
    return "gray";
  }
  return "green";
}

function toastTextWidth(contentWidth: number): number {
  return Math.max(1, contentWidth - 2);
}
