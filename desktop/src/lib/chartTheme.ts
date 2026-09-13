/**
 * Recharts takes SVG props, not Tailwind classes, so chart colours have to be
 * resolved to concrete values.
 *
 * They are READ FROM the live CSS custom properties rather than duplicated as
 * hex literals: the app now has light and dark themes, and a second hand-kept
 * copy of the palette would drift and would always paint dark-theme colours.
 *
 * Call `chartTheme()` during render (not at module scope) so a theme change
 * picks up the new values on the next paint.
 */

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** `color` at `alpha` opacity, via `color-mix` so any colour syntax works. */
function alpha(color: string, a: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}

export interface ChartTheme {
  line: string;
  lineNegative: string;
  gradientFrom: string;
  gradientTo: string;
  gradientFromNeg: string;
  gradientToNeg: string;
  grid: string;
  axisTick: { fontSize: number; fill: string };
  tooltip: React.CSSProperties;
  tooltipLabel: { color: string };
  cursor: { stroke: string; strokeWidth: number };
  /** Categorical series colours for allocation/comparison charts. */
  series: string[];
}

export function chartTheme(): ChartTheme {
  const accent = cssVar("--sc-accent", "#28EBCF");
  const negative = cssVar("--sc-negative", "#FF4D5E");
  const positive = cssVar("--sc-positive", "#30D158");
  const warning = cssVar("--sc-warning", "#FFB020");
  const info = cssVar("--sc-info", "#5AC8FA");
  const border = cssVar("--sc-border", "#232428");
  const borderStrong = cssVar("--sc-border-strong", "#34363C");
  const textSecondary = cssVar("--sc-text-secondary", "#9EA1AA");
  const textTertiary = cssVar("--sc-text-tertiary", "#63666E");
  const card = cssVar("--sc-bg-card", "#1A1B1F");

  return {
    line: accent,
    lineNegative: negative,
    gradientFrom: alpha(accent, 0.28),
    gradientTo: alpha(accent, 0),
    gradientFromNeg: alpha(negative, 0.22),
    gradientToNeg: alpha(negative, 0),
    grid: border,
    axisTick: { fontSize: 11, fill: textTertiary },
    tooltip: {
      backgroundColor: card,
      border: `1px solid ${borderStrong}`,
      borderRadius: 12,
      boxShadow: "var(--sc-shadow-pop)",
      fontSize: 12,
    },
    tooltipLabel: { color: textSecondary },
    cursor: { stroke: borderStrong, strokeWidth: 1 },
    series: [accent, info, warning, positive, negative, textSecondary],
  };
}

/**
 * Back-compat for call sites that import `chart` directly.
 *
 * Every property read re-resolves from the live CSS variables, so this object
 * can never go stale the way a snapshot taken at module load would — importing
 * it before the stored theme is applied is safe.
 */
export const chart = new Proxy({} as ChartTheme, {
  get: (_target, prop: string) => chartTheme()[prop as keyof ChartTheme],
  has: (_target, prop: string) => prop in chartTheme(),
  ownKeys: () => Reflect.ownKeys(chartTheme()),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});
