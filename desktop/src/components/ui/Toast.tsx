import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Errors stay until dismissed; everything else auto-hides. */
const AUTO_DISMISS_MS: Record<ToastTone, number | null> = {
  success: 4000,
  info: 5000,
  warning: 8000,
  error: null,
};

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const TONE_CLASS: Record<ToastTone, string> = {
  success: "text-positive",
  error: "text-negative",
  warning: "text-warning",
  info: "text-info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...toast, id }]);
      const ttl = AUTO_DISMISS_MS[toast.tone];
      if (ttl !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ttl)
        );
      }
    },
    [dismiss]
  );

  // Clear any pending timers if the provider unmounts mid-flight.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-full max-w-sm flex-col gap-2"
        // Assertive would interrupt a screen reader mid-sentence; these are
        // confirmations, not alarms.
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];
          return (
            <div
              key={toast.id}
              className="animate-slide-up pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-bg-card p-3.5 shadow-pop"
            >
              <Icon size={18} className={cn("mt-px shrink-0", TONE_CLASS[toast.tone])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs whitespace-pre-line text-text-secondary">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="cursor-pointer rounded-md p-1 text-text-tertiary transition-colors hover:bg-hover hover:text-text-primary"
                aria-label={t.common.close}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside a ToastProvider");
  return ctx;
}
