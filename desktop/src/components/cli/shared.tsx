import type { ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Shared bits for the CLI console. `getCapabilities()` is typed loosely in
 * `api/types.ts` (`workflows`/`local_trade_controls` are `Record<string, unknown>`)
 * because the CLI forwards its own JSON verbatim — these narrow that shape
 * locally, from the real payload built in `src/lib.rs::machine_capabilities`
 * and `src/trade_controls.rs::TradeControlsPolicy::capabilities_payload`.
 */

export interface LocalTradeControls {
  enabled?: boolean;
  isin_controls_active?: boolean;
  allowed_isins_configured?: boolean;
  denied_isins_configured?: boolean;
  max_order_notional_active?: boolean;
  enforced_on?: string[];
  allowed_isins?: string[];
  denied_isins?: string[];
  isin_resolution?: string;
  max_order_notional?: string | null;
}

export interface WorkflowPresentationRequirement {
  rule_id?: string;
  must_present_all_information?: boolean;
  instruction?: string;
  requires_explicit_user_confirmation_between_phases?: boolean;
  forbid_automatic_phase_2_execution?: boolean;
  confirmation_must_be_separate_step?: boolean;
  format?: string;
  section_order?: string[];
  required_leaf_paths?: string[];
  preserve_exact_values?: boolean;
  display_null_as_literal?: boolean;
  raw_json_only_on_user_request?: boolean;
}

export interface WorkflowEntry {
  mode?: string;
  phase_1?: string;
  phase_2?: string;
  preferred_output?: string;
  phase_1_command_template_json?: string;
  phase_2_command_template_json?: string;
  raw_json_not_recommended_for_humans?: boolean;
  phase_1_presentation_requirement?: WorkflowPresentationRequirement;
}

/** A raw JSON field name (as the CLI spells it) paired with its value. */
export function Field({
  name,
  children,
  className,
}: {
  name: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 py-2.5", className)}>
      <code className="shrink-0 text-2xs text-text-tertiary">{name}</code>
      <div className="flex flex-wrap items-center justify-end gap-1.5">{children}</div>
    </div>
  );
}

/** Renders a boolean the way the CLI reports it — a mark, not a translated word. */
export function BoolIcon({ value }: { value: boolean | undefined }) {
  return value ? (
    <Check size={14} className="text-positive" aria-label="true" />
  ) : (
    <Minus size={14} className="text-text-tertiary" aria-label="false" />
  );
}

/** Small monospace chips for a list of raw identifiers (ISINs, command ids, paths). */
export function MonoChips({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-2xs text-text-tertiary">—</span>;
  return (
    <>
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-hover px-2 py-0.5 font-mono text-2xs text-text-secondary"
        >
          {item}
        </span>
      ))}
    </>
  );
}

/** A long list of raw paths, kept fully in the DOM but scrollable. */
export function CodeList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-2xs text-text-tertiary">—</span>;
  return (
    <pre className="max-h-48 w-full overflow-y-auto rounded-lg bg-bg-inset p-2.5 font-mono text-2xs leading-relaxed text-text-secondary">
      {items.join("\n")}
    </pre>
  );
}

export function PanelCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y divide-border rounded-2xl border border-border bg-bg-card px-4", className)}>
      {children}
    </div>
  );
}
