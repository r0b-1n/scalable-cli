/**
 * Platform-aware keyboard hints.
 *
 * The app ships on macOS, Windows and Linux from one bundle, so a hardcoded
 * "Ctrl+K" is simply wrong on a Mac. Detect once and render the right glyph.
 */

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // `platform` is deprecated but still the most reliable signal inside a
  // WebKitGTK/WKWebView shell; fall back to the UA string.
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;
  return /mac|iphone|ipad/i.test(platform);
}

const MAC = isMac();

/** The modifier label for this platform: "⌘" or "Ctrl". */
export const modKey = MAC ? "⌘" : "Ctrl";

/** Render a chord for display, e.g. shortcut("K") → "⌘K" or "Ctrl+K". */
export function shortcut(key: string, opts: { shift?: boolean } = {}): string {
  const shift = opts.shift ? (MAC ? "⇧" : "Shift+") : "";
  return MAC ? `${shift}${modKey}${key}` : `${modKey}+${shift}${key}`;
}
