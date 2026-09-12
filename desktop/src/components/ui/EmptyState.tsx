import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 px-4", className)}>
      {icon && (
        <div className="w-12 h-12 mb-4 rounded-full bg-bg-card flex items-center justify-center text-text-tertiary">
          {icon}
        </div>
      )}
      <h3 className="text-base font-medium text-text-primary mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-text-secondary text-center max-w-sm mb-6">{description}</p>
      )}
      {action}
    </div>
  );
}
