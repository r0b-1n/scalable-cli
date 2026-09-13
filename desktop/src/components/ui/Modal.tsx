import { cn } from "../../lib/utils";
import { useCallback, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../i18n";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
  /** Accessible name when the modal has no visible `title`. */
  ariaLabel?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog with a real focus trap.
 *
 * A modal that leaves focus behind it is only visually modal: keyboard and
 * screen-reader users can tab straight into the page underneath. So this moves
 * focus in on open, cycles Tab within the dialog, and restores focus to the
 * trigger on close.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  className,
  maxWidth = "max-w-lg",
  ariaLabel,
}: ModalProps) {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const focusables = useCallback(
    () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      ),
    []
  );

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    // Focus the first control, or the dialog itself when it has none.
    const initial = focusables()[0] ?? dialogRef.current;
    initial?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at both ends so Tab never escapes the dialog.
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = "";
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, onClose, focusables]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={cn(
          "animate-scale-in mx-4 w-full rounded-2xl border border-border bg-bg-secondary shadow-modal outline-none",
          maxWidth,
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 id={titleId} className="text-lg font-semibold text-text-primary">
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label={t.common.close}
              className="cursor-pointer rounded-lg p-1 text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
