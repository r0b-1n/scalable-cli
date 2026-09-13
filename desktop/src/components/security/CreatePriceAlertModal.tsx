import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";
import { useToast } from "../ui/Toast";
import { renderCliCommand } from "../../lib/cliLog";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Spinner from "../ui/Spinner";
import CliCommand from "../ui/CliCommand";

interface CreatePriceAlertModalProps {
  open: boolean;
  onClose: () => void;
  isin: string;
  name?: string | null;
  portfolioId?: string;
}

export default function CreatePriceAlertModal({ open, onClose, isin, name, portfolioId }: CreatePriceAlertModalProps) {
  const { t } = useI18n();
  const { push } = useToast();
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPrice("");
    setError(null);
    // Prefill with the live mid price so the field starts from something
    // meaningful rather than empty.
    api
      .getQuote(isin, { portfolioId })
      .then((data) => setPrice(data.result.quote_mid_price != null ? String(data.result.quote_mid_price) : ""))
      .catch(() => undefined);
  }, [open, isin, portfolioId]);

  const priceNum = parseFloat(price);
  const canSubmit = Number.isFinite(priceNum) && priceNum > 0;

  const submit = async () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.addPriceAlert({ isin, price: price.trim(), portfolioId });
      push({ tone: "success", title: t.alerts.createAlert, description: name || isin });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.actionFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={t.alerts.modalTitle} maxWidth="max-w-sm">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-text-primary">{name || isin}</p>
          <p className="text-2xs text-text-tertiary">{isin}</p>
        </div>
        <Input
          label={t.alerts.targetPrice}
          type="number"
          min="0"
          step="0.01"
          placeholder={t.alerts.pricePlaceholder}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {error && (
          <div className="rounded-lg border border-negative/20 bg-negative/10 p-3">
            <p className="text-xs text-negative">{error}</p>
          </div>
        )}
        <CliCommand commands={renderCliCommand("add_price_alert", { isin, price: price.trim() || "<price>", portfolioId })} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting ? <Spinner size={16} className="mr-2" /> : null}
            {t.alerts.createAlert}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
