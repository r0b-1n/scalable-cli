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
          "inline-flex items-center justify-center rounded-full font-medium transition-all duration-150 cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
          {
            "bg-accent text-bg-primary font-semibold hover:bg-accent-hover active:bg-accent-pressed":
              variant === "primary",
            "bg-bg-card text-text-primary border border-border-strong hover:bg-bg-card-hover":
              variant === "secondary",
            "text-text-secondary hover:text-text-primary hover:bg-bg-card": variant === "ghost",
            "bg-negative/15 text-negative hover:bg-negative/25": variant === "danger",
            "bg-positive/15 text-positive hover:bg-positive/25": variant === "success",
          },
          {
            "h-8 px-3.5 text-xs": size === "sm",
            "h-10 px-5 text-sm": size === "md",
            "h-12 px-7 text-sm font-semibold": size === "lg",
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
