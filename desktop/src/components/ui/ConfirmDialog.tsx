import { type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";
import Spinner from "./Spinner";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "default" | "danger";
  busy?: boolean;
}

/**
 * Confirmation for a destructive or irreversible action (deleting a group,
 * cancelling an order, removing a savings plan).
 *
 * This is NOT the trade/savings-plan two-phase confirmation: those must show
 * the CLI's full ex-ante disclosure, which lives in the trade ticket.
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="space-y-5">
        <div className="flex gap-3">
          {tone === "danger" && (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-negative-dim">
              <AlertTriangle size={16} className="text-negative" />
            </span>
          )}
          {description && (
            <div className="text-sm leading-relaxed text-text-secondary">{description}</div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Spinner size={16} /> : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
