/**
 * Theme controller.
 *
 * Three states: an explicit "light"/"dark" choice stamps `data-theme` on
 * <html> and wins over the OS; "system" stamps nothing and lets the
 * `prefers-color-scheme` block in styles.css decide, following the OS live.
 */

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "sc-desktop-theme";

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    // Private mode / blocked storage: fall back to following the OS.
    return "system";
  }
}

export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Not persisting is survivable; the applied theme still takes effect.
  }
  applyTheme(preference);
}

/** The theme actually being rendered right now. */
export function resolvedTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/** Apply the stored preference as early as possible to avoid a flash. */
export function initTheme() {
  applyTheme(readThemePreference());
}
