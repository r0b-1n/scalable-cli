import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Small count/state shown after the label. */
  badge?: ReactNode;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Underlined tab bar. Uses real `role="tab"` semantics plus arrow-key roving
 * focus so the whole bar is one tab stop, as native tabs are.
 */
export default function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: TabsProps<T>) {
  const move = (delta: number) => {
    const index = items.findIndex((i) => i.value === value);
    const next = items[(index + delta + items.length) % items.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-1 border-b border-border", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative -mb-px cursor-pointer px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "text-text-primary"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            <span className="flex items-center gap-2">
              {item.label}
              {item.badge != null && (
                <span className="rounded-full bg-hover px-1.5 py-0.5 text-2xs text-text-tertiary tabular-nums">
                  {item.badge}
                </span>
              )}
            </span>
            {active && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
