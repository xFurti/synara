// FILE: threadLink.ts
// Purpose: Build and parse local-only task URLs for copy-link and desktop protocol open.

const THREAD_ID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu;

export function buildThreadLink(
  threadId: string,
  input: { origin: string; isElectron: boolean },
): string {
  const origin = input.origin.replace(/\/+$/u, "");
  if (input.isElectron) {
    return `${origin}/index.html#/${threadId}`;
  }
  return `${origin}/${threadId}`;
}

export function buildThreadLinkFromWindow(threadId: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const isElectron =
    typeof window !== "undefined" && typeof window.desktopBridge !== "undefined";
  return buildThreadLink(threadId, { origin, isElectron });
}

export function parseThreadIdFromAppUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const haystack = `${parsed.pathname}${parsed.hash}`;
    const match = haystack.match(THREAD_ID_PATTERN);
    return match?.[0]?.toLowerCase() ?? null;
  } catch {
    const match = url.match(THREAD_ID_PATTERN);
    return match?.[0]?.toLowerCase() ?? null;
  }
}
