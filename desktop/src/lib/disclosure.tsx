import type { ReactNode } from "react";
import type { PresentationField, PresentationSection } from "../api/types";

/**
 * Rendering helpers for every surface that shows CLI-authored disclosure data:
 * the trade ticket's mandated ex-ante cost disclosure, the savings-plan
 * equivalent, the cost what-if comparison, and the order/transaction detail
 * modals.
 *
 * The CLI's compliance rule is the same for all of them — every section
 * rendered in full, values verbatim, no rounding, no unit conversion, no
 * re-labelling — so the logic deciding how a raw JSON value becomes a table
 * cell lives once, here, and cannot drift between two surfaces that are
 * legally required to agree.
 */

/** `some_json_key` → "Some json key". Used only for endpoints (like
 * transaction detail) that return raw keys instead of the labelled
 * `{label, value}` pairs a trade disclosure provides. */
export function prettifyKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isLinkValue(v: unknown): v is { label?: unknown; url: string } {
  return typeof v === "object" && v !== null && typeof (v as Record<string, unknown>).url === "string";
}

/**
 * Renders one disclosure/detail value EXACTLY as the CLI returned it.
 * `nullAsLiteral` mirrors `compliance.presentation.display_null_as_literal`:
 * when the CLI marks null as meaningful, it must read as the literal word
 * "null" rather than a blank placeholder.
 */
export function formatDisclosureValue(value: unknown, nullAsLiteral = false): ReactNode {
  if (value === null || value === undefined) {
    return nullAsLiteral ? (
      <span className="font-mono text-text-secondary">null</span>
    ) : (
      <span className="text-text-tertiary">—</span>
    );
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-text-tertiary">—</span>;
    return (
      <div className="space-y-1 text-right">
        {value.map((item, i) => (
          <div key={i}>{formatDisclosureValue(item, nullAsLiteral)}</div>
        ))}
      </div>
    );
  }
  if (isLinkValue(value)) {
    const label = typeof value.label === "string" && value.label ? value.label : value.url;
    return (
      <a
        href={value.url}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {label}
      </a>
    );
  }
  if (typeof value === "object") {
    return (
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all text-left font-mono text-2xs text-text-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return String(value);
}

/** Finds the first disclosure field across all sections whose `path` contains
 * `needle` (case-insensitive) — used to source the accept-unsuitable
 * checkbox's label from the CLI's own disclosure text instead of inventing
 * new copy for it. */
export function findFieldByPath(
  sections: Record<string, PresentationSection>,
  needle: string
): PresentationField | null {
  const lower = needle.toLowerCase();
  for (const key of Object.keys(sections)) {
    const hit = sections[key]?.fields?.find((f) => f.path?.toLowerCase().includes(lower));
    if (hit) return hit;
  }
  return null;
}

const ORDER_ID_KEY = /(?:^|_)order[_-]?id$/i;

/** Best-effort search for an order id anywhere in a trade-submit result —
 * the CLI's JSON shape for a placed order isn't fixed, so this looks for the
 * key rather than assuming a path. */
export function findOrderId(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (ORDER_ID_KEY.test(k) && (typeof v === "string" || typeof v === "number") && String(v)) {
      return String(v);
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findOrderId(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** `expires_at_epoch` is documented in whole seconds; guard against a value
 * that already looks like milliseconds. */
export function epochToDate(expiresAtEpoch: number): Date {
  const ms = expiresAtEpoch > 1e12 ? expiresAtEpoch : expiresAtEpoch * 1000;
  return new Date(ms);
}
