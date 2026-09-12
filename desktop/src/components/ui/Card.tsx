import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
  hover?: boolean;
  variant?: "default" | "flat";
  onClick?: () => void;
}

export default function Card({
  children,
  className,
  padding = true,
  hover = false,
  variant = "default",
  onClick,
}: CardProps) {
  return (
    <div
      className={cn(
        variant === "default" && "bg-bg-card rounded-2xl border border-border shadow-card",
        padding && "p-5",
        hover &&
          "hover:bg-bg-card-hover hover:border-border-strong transition-all duration-200 cursor-pointer",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between mb-4", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3
      className={cn(
        "text-2xs font-medium tracking-[0.08em] uppercase text-text-tertiary",
        className
      )}
    >
      {children}
    </h3>
  );
}
