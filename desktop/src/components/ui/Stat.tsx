import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

interface StatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Rendered as a small pill next to the value, colored by sign. */
  delta?: { text: string; positive: boolean };
  size?: "hero" | "lg" | "md";
  className?: string;
}

export default function Stat({ label, value, sub, delta, size = "md", className }: StatProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-xs text-text-secondary">{label}</p>
      <div className="flex items-baseline gap-3">
        <span
          className={cn("tabular-nums tracking-tight font-semibold text-text-primary", {
            "text-5xl": size === "hero",
            "text-2xl": size === "lg",
            "text-lg": size === "md",
          })}
        >
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "text-2xs font-medium rounded-full px-2 py-0.5 tabular-nums",
              delta.positive ? "text-positive bg-positive/10" : "text-negative bg-negative/10"
            )}
          >
            {delta.text}
          </span>
        )}
      </div>
      {sub && <p className="text-xs text-text-tertiary">{sub}</p>}
    </div>
  );
}
