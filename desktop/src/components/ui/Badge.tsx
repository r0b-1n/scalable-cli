import { cn } from "../../lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "accent" | "positive" | "negative" | "warning";
  className?: string;
}

export default function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium",
        {
          "bg-hover text-text-secondary": variant === "default",
          "bg-accent-dim text-accent": variant === "accent",
          "bg-positive/15 text-positive": variant === "positive",
          "bg-negative/15 text-negative": variant === "negative",
          "bg-warning/15 text-warning": variant === "warning",
        },
        className
      )}
    >
      {children}
    </span>
  );
}
