import { cn } from "../../lib/utils";

export interface AllocationSlice {
  label: string;
  value: number;
  color: string;
}

/**
 * Horizontal proportion bar — a compact stand-in for a pie chart that stays
 * readable at table width.
 */
export default function AllocationBar({
  slices,
  className,
  showLegend = true,
}: {
  slices: AllocationSlice[];
  className?: string;
  showLegend?: boolean;
}) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex h-2 overflow-hidden rounded-full bg-bg-inset">
        {slices.map((slice) => {
          const pct = (Math.max(0, slice.value) / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={slice.label}
              style={{ width: `${pct}%`, backgroundColor: slice.color }}
              title={`${slice.label} — ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      {showLegend && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {slices.map((slice) => (
            <li key={slice.label} className="flex items-center gap-1.5 text-2xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="text-text-secondary">{slice.label}</span>
              <span className="text-text-tertiary tabular-nums">
                {((Math.max(0, slice.value) / total) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
