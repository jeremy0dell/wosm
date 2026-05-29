export function pathIsSame(candidate: string, root: string): boolean {
  return normalizeLocalPath(candidate) === normalizeLocalPath(root);
}

export function pathIsSameOrInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeLocalPath(candidate);
  const normalizedRoot = normalizeLocalPath(root);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  if (normalizedRoot === "/") {
    return normalizedCandidate.startsWith("/");
  }
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

export function normalizeLocalPath(value: string): string {
  const trimmed = value.trim();
  const withoutTrailingSlash = trimmed.length > 1 ? trimmed.replace(/\/+$/g, "") : trimmed;
  return withoutTrailingSlash.startsWith("/private/var/")
    ? `/var/${withoutTrailingSlash.slice("/private/var/".length)}`
    : withoutTrailingSlash;
}
