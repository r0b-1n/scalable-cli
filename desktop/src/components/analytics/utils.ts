/**
 * Defensive readers for `getBrokerAnalytics`'s loosely-typed payload.
 *
 * `allocations`, `health_checks`, `scenarios`, `equity_company_styles` and
 * `fixed_income_ratings` are declared as `Record<string, unknown>[]` /
 * `Record<string, unknown> | null` in `api/types.ts` on purpose — the backend
 * forwards raw analysis data whose exact field set is not guaranteed, so
 * every read here goes through helpers that never throw on a missing key.
 */

export type AnyRecord = Record<string, unknown>;

export function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** First non-empty string field among `keys`, checked in order. */
export function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return undefined;
}

/** First finite-number field among `keys` — also accepts numeric strings. */
export function pickNumber(obj: unknown, keys: string[]): number | undefined {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** First boolean-ish field among `keys` (real booleans only — no truthy strings). */
export function pickBoolean(obj: unknown, keys: string[]): boolean | undefined {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

/** Any array field among `keys`, or an empty array if none is present. */
export function pickArray(obj: unknown, keys: string[]): unknown[] {
  if (!isRecord(obj)) return [];
  for (const key of keys) {
    const v = obj[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** snake_case / camelCase → "Title case", for rendering an unrecognised key as a label. */
export function prettifyKey(key: string): string {
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A best-effort "does this look like a plain, displayable value" check. */
export function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * Every primitive field of `obj` other than `exclude`, as label/value pairs —
 * the last-resort renderer for a record whose shape is genuinely unknown.
 */
export function remainingEntries(
  obj: unknown,
  exclude: string[]
): { label: string; value: string | number | boolean }[] {
  if (!isRecord(obj)) return [];
  const skip = new Set(exclude);
  return Object.entries(obj)
    .filter(([k, v]) => !skip.has(k) && isPrimitive(v))
    .map(([k, v]) => ({ label: prettifyKey(k), value: v as string | number | boolean }));
}
