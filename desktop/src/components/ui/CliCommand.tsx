import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";

/**
 * Shows the `sc` command behind a screen, and lets the user copy it.
 *
 * The CLI is the product: anything the app can do should be reproducible in a
 * terminal, so every view states the command that produced it rather than
 * presenting the data as if it came from nowhere.
 */

export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    // Tauri's webview exposes the async clipboard API; if it is unavailable
    // the button simply does not confirm rather than throwing at the user.
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return [copied, copy];
}

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, copy] = useCopy();
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      aria-label={label ?? t.common.copy}
      title={label ?? t.common.copy}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-2xs text-text-tertiary transition-colors hover:bg-hover hover:text-text-primary",
        className
      )}
    >
      {copied ? <Check size={13} className="text-positive" /> : <Copy size={13} />}
      {label && <span>{label}</span>}
    </button>
  );
}

interface CliCommandProps {
  /** One or more `sc …` command lines that produced the current view. */
  commands: string | string[];
  className?: string;
  /** `inline` is a single muted line; `block` is a bordered code panel. */
  variant?: "inline" | "block";
}

export default function CliCommand({
  commands,
  className,
  variant = "inline",
}: CliCommandProps) {
  const lines = Array.isArray(commands) ? commands : [commands];
  const joined = lines.join("\n");
  if (lines.length === 0) return null;

  if (variant === "block") {
    return (
      <div className={cn("rounded-xl border border-border bg-bg-inset", className)}>
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="flex items-center gap-2 text-2xs font-medium tracking-[0.08em] text-text-tertiary uppercase">
            <Terminal size={12} />
            Scalable CLI
          </span>
          <CopyButton value={joined} />
        </div>
        <pre className="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed text-text-secondary">
          {lines.map((line) => (
            <div key={line}>
              <span className="mr-2 text-text-tertiary select-none">$</span>
              {line}
            </div>
          ))}
        </pre>
      </div>
    );
  }

  return (
    <div className={cn("group flex items-center gap-2 text-2xs text-text-tertiary", className)}>
      <Terminal size={12} className="shrink-0" />
      <code className="truncate font-mono">{lines[0]}</code>
      <CopyButton
        value={joined}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}
