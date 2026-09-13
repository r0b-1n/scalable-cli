import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";

/**
 * Loading placeholder. Prefer this over a centred spinner for content that has
 * a known shape — the layout stays put instead of jumping when data lands.
 */
export default function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-shimmer rounded-md bg-bg-card-hover", className)}
      {...props}
    />
  );
}

/** A block of stacked lines, e.g. while a list loads. */
export function SkeletonLines({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          // Ragged widths read as text rather than as a loading bar.
          style={{ width: `${100 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}

/** Placeholder rows matching the DataTable grid. */
export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  const { t } = useI18n();
  return (
    <div className="space-y-px" role="status" aria-label={t.common.loading}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-2/5" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}
