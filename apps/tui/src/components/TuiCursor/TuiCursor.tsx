import { Text } from "ink";
import { useEffect, useState } from "react";

export type TuiCursorProps = {
  blinkIntervalMs?: number;
  cell?: string;
};

export function TuiCursor({ blinkIntervalMs = 500, cell = "|" }: TuiCursorProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((current) => !current);
    }, blinkIntervalMs);
    return () => clearInterval(timer);
  }, [blinkIntervalMs]);

  return <Text>{visible ? cell : " ".repeat(cell.length)}</Text>;
}
