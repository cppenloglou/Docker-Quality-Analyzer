/** Open container preview in a real browser window (top-level navigation, not an iframe). */

const POPOUT_FEATURES = [
  "noopener",
  "noreferrer",
  "width=1280",
  "height=860",
  "menubar=no",
  "toolbar=yes",
  "location=yes",
  "status=yes",
  "resizable=yes",
  "scrollbars=yes",
].join(",");

const popoutWindows = new Map<string, Window | null>();

function popoutWindowName(url: string): string {
  try {
    const parsed = new URL(url);
    return `dqa-preview-${parsed.host}-${parsed.port || "80"}`;
  } catch {
    return "dqa-preview";
  }
}

/** Opens or focuses a pop-out window — same experience as opening the URL in Chrome/Firefox. */
export function openPopOutPreview(url: string, options?: { replace?: boolean }): Window | null {
  if (typeof window === "undefined" || !url.trim()) return null;

  const name = popoutWindowName(url);
  const existing = popoutWindows.get(name);
  if (existing && !existing.closed) {
    try {
      existing.location.href = url;
      existing.focus();
      return existing;
    } catch {
      /* cross-origin focus/nav may fail; open fresh */
    }
  }

  const opened = window.open(url, options?.replace ? name : "_blank", POPOUT_FEATURES);
  if (opened) {
    popoutWindows.set(name, opened);
    opened.focus();
  }
  return opened;
}

export function collectBrowserProxyHints(): {
  user_agent: string;
  accept_language: string;
} {
  if (typeof navigator === "undefined") {
    return { user_agent: "", accept_language: "" };
  }
  return {
    user_agent: navigator.userAgent,
    accept_language: navigator.languages?.length
      ? navigator.languages.join(",")
      : navigator.language || "en-US,en;q=0.9",
  };
}
