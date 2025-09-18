/**
 * Extracts the page token from a next page URL.
 */
export function extractPageToken(nextUrl: string | undefined): string | undefined {
  if (!nextUrl) return undefined;
  try {
    const url = new URL(nextUrl);
    return url.searchParams.get("page_token") ?? undefined;
  } catch {
    return undefined;
  }
}
