import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cn("w-full", className)}>{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border">{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-2xs font-medium uppercase tracking-wider text-text-tertiary",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </th>
  );
}

export function TR({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-0 transition-colors",
        onClick && "cursor-pointer hover:bg-bg-card-hover/60",
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  numeric = false,
  className,
}: {
  children?: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td className={cn("px-4 py-3.5 text-sm", numeric && "text-right tabular-nums", className)}>
      {children}
    </td>
  );
}
