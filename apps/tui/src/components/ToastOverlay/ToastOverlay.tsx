import type { TuiToastEntry } from "@wosm/dashboard-core";
import {
  toastBorderColor,
  toastDetail,
  toastOverlayLayout,
  toastTextWidth,
  toastTitle,
  truncateCells,
} from "@wosm/dashboard-core";
import { Box, Text } from "ink";
import { FloatingBlankBackground } from "../FloatingBlankBackground/FloatingBlankBackground.js";

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
