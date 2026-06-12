// OpenTUI port of apps/tui's ToastOverlay: absolute-positioned box above the
// dashboard's bottom-right, sized by the shared toast layout, with the toast
// copy and color decisions coming from the shared content module. Ink's
// FloatingBlankBackground hack is unnecessary — the box paints its own
// background. Click dismisses (Station mouse extension).
import { TextAttributes } from "@opentui/core";
import {
  toastBorderColor,
  type ToastBorderColorName,
  toastDetail,
  toastOverlayLayout,
  toastTextWidth,
  toastTitle,
  truncateCells,
  type TuiToastEntry,
} from "@wosm/dashboard-core";
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
      borderColor={borderColorHex(toastBorderColor(toast))}
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

function borderColorHex(name: ToastBorderColorName): string {
  if (name === "red") {
    return WOSM_COLORS.red;
  }
  if (name === "gray") {
    return WOSM_COLORS.gray;
  }
  return WOSM_COLORS.green;
}
