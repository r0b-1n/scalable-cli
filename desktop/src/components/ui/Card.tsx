import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
  hover?: boolean;
  onClick?: () => void;
}

export default function Card({ children, className, padding = true, hover = false, onClick }: CardProps) {
  return (
    <div
      className={cn(
        "bg-bg-card rounded-xl border border-border",
        padding && "p-5",
        hover && "hover:bg-bg-card-hover hover:border-accent/20 transition-all duration-200 cursor-pointer",
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
    <h3 className={cn("text-sm font-semibold text-text-secondary uppercase tracking-wider", className)}>
      {children}
    </h3>
  );
}
