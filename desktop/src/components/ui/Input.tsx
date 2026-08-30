import { cn } from "../../lib/utils";
import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-text-secondary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            "w-full px-3 py-2 bg-bg-card border border-border rounded-lg text-text-primary text-sm",
            "placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent",
            "transition-colors duration-150",
            error && "border-negative focus:ring-negative/30 focus:border-negative",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-negative">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
