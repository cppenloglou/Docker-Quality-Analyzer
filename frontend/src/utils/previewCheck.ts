/** Client-side guards before hitting the preview probe API. */
export function localPreviewIssue(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    if (
      (port === "8000" || port === "8001") &&
      (host === "localhost" || host === "127.0.0.1" || host === "::1")
    ) {
      return "That URL is the platform API (port 8000), not your container app. Pick a published container port from the list.";
    }
    if (
      parsed.pathname.startsWith("/api") ||
      parsed.pathname.startsWith("/docs") ||
      parsed.pathname.startsWith("/redoc") ||
      parsed.pathname === "/openapi.json" ||
      parsed.pathname.startsWith("/metrics")
    ) {
      return "That path belongs to the platform API. Use the container host:port from deploy status.";
    }
  } catch {
    return "Enter a valid http://host:port URL.";
  }
  return null;
}
