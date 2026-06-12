// OpenTUI port of apps/tui's ToastOverlay: absolute-positioned box above the
// dashboard's bottom-right, sized by the ported toast layout. Ink's
// FloatingBlankBackground hack is unnecessary — the box paints its own
// background. Click dismisses (Station mouse extension).
import { TextAttributes } from "@opentui/core";
import { toastOverlayLayout } from "../ported/components/ToastOverlay/layout.js";
import { truncateCells } from "../ported/components/WorktreeRow/layout.js";
import type { TuiToastEntry } from "../ported/state/types.js";
import { WOSM_COLORS } from "./theme.js";
import { useWosmMouse, wosmMouseProps } from "./wosmMouseContext.js";

export type ToastOverlayViewProps = {
  columns: number;
  rows: number;
  toast: TuiToastEntry | undefined;
  promptRows: number;
  hiddenByModal: boolean;
};

export function ToastOverlayView({
  columns,
  rows,
  toast,
  promptRows,
  hiddenByModal,
}: ToastOverlayViewProps) {
  const dispatch = useWosmMouse();
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
    <box
      position="absolute"
      left={layout.left}
      top={layout.top}
      width={layout.width}
      height={layout.height}
      zIndex={20}
      border
      borderColor={toastBorderColor(toast)}
      backgroundColor={WOSM_COLORS.background}
      flexDirection="column"
      {...wosmMouseProps(dispatch, { kind: "toast" })}
    >
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <text fg={WOSM_COLORS.foreground} attributes={TextAttributes.BOLD}>
          {truncateCells(toastTitle(toast), textWidth)}
        </text>
        <text fg={WOSM_COLORS.foreground}>{truncateCells(toast.toast.message, textWidth)}</text>
        {detail === undefined ? null : (
          <text fg={WOSM_COLORS.gray}>{truncateCells(detail, textWidth)}</text>
        )}
      </box>
    </box>
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

function toastBorderColor(entry: TuiToastEntry): string {
  if (entry.toast.kind === "error") {
    return WOSM_COLORS.red;
  }
  if (entry.toast.kind === "info") {
    return WOSM_COLORS.gray;
  }
  return WOSM_COLORS.green;
}

function toastTextWidth(contentWidth: number): number {
  return Math.max(1, contentWidth - 2);
}
