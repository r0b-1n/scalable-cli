import { cn } from "../../lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          {
            "bg-accent text-bg-primary hover:bg-accent-hover active:scale-[0.98]": variant === "primary",
            "bg-bg-card text-text-primary border border-border hover:bg-bg-card-hover active:scale-[0.98]": variant === "secondary",
            "text-text-secondary hover:text-text-primary hover:bg-bg-card active:scale-[0.98]": variant === "ghost",
            "bg-negative/15 text-negative hover:bg-negative/25 active:scale-[0.98]": variant === "danger",
            "bg-positive/15 text-positive hover:bg-positive/25 active:scale-[0.98]": variant === "success",
          },
          {
            "px-3 py-1.5 text-xs": size === "sm",
            "px-4 py-2 text-sm": size === "md",
            "px-6 py-3 text-base": size === "lg",
          },
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
