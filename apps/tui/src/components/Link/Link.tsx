import { createHash } from "node:crypto";
import { Transform } from "ink";
import type { ReactNode } from "react";

export type LinkProps = {
  url: string;
  children: ReactNode;
};

function linkId(url: string): string {
  return `wosm-${createHash("sha256").update(url).digest("base64url").slice(0, 12)}`;
}

export function Link({ url, children }: LinkProps) {
  return <Transform transform={(text) => formatLink(url, text)}>{children}</Transform>;
}

export function formatLink(url: string, text: string): string {
  return `\u001B]8;id=${linkId(url)};${url}\u0007${text}\u001B]8;;\u0007`;
}
