import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Spinner from "../ui/Spinner";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";
import type { CapabilitiesData } from "../../api/types";

/** The fields of `capabilities.local_trade_controls` this form edits. */
export interface EditableTradeControls {
  allowed_isins_configured?: boolean;
  allowed_isins?: string[];
  denied_isins?: string[];
  max_order_notional?: string | null;
}

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

function parseIsins(raw: string): string[] {
  return Array.from(new Set(raw.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)));
}

/**
 * Edits `[trade_controls]` in config.toml. The Tauri side writes the file and
 * has the CLI validate it, restoring the previous file if the CLI rejects it,
 * so what is shown afterwards is what the CLI will actually enforce.
 */
export default function TradeControlsModal({
  open,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  current: EditableTradeControls | undefined;
  onClose: () => void;
  onSaved: (capabilities: CapabilitiesData) => void;
}) {
  const { t } = useI18n();
  const s = t.settings;
  const [allowedOn, setAllowedOn] = useState(false);
  const [allowed, setAllowed] = useState("");
  const [denied, setDenied] = useState("");
  const [max, setMax] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAllowedOn(Boolean(current?.allowed_isins_configured));
    setAllowed((current?.allowed_isins ?? []).join("\n"));
    setDenied((current?.denied_isins ?? []).join("\n"));
    setMax(current?.max_order_notional ?? "");
    setError(null);
  }, [open, current]);

  const allowedList = parseIsins(allowed);
  const deniedList = parseIsins(denied);
  const invalid = [...(allowedOn ? allowedList : []), ...deniedList].find((i) => !ISIN.test(i));
  const maxInvalid = max.trim() !== "" && !/^\d+(\.\d+)?$/.test(max.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const caps = await api.setTradeControls({
        allowedIsins: allowedOn ? allowedList : undefined,
        deniedIsins: deniedList.length > 0 ? deniedList : undefined,
        maxOrderNotional: max.trim() || undefined,
      });
      onSaved(caps);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const textarea =
    "w-full rounded-lg border border-border-strong bg-bg-inset px-3 py-2 font-mono text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

  return (
    <Modal isOpen={open} onClose={onClose} title={t.cli.tradeControls} maxWidth="max-w-lg">
      <div className="space-y-5">
        <p className="text-sm text-text-secondary">{s.tradeControlsHint}</p>

        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" checked={allowedOn} onChange={(e) => setAllowedOn(e.target.checked)} />
            {s.tradeControlsAllowedToggle}
          </label>
          {allowedOn && (
            <>
              <textarea
                aria-label={s.allowedIsins}
                placeholder={s.tradeControlsIsinList}
                rows={3}
                value={allowed}
                onChange={(e) => setAllowed(e.target.value)}
                className={textarea}
              />
              <p className="text-xs text-text-tertiary">{s.tradeControlsAllowedHelp}</p>
            </>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-text-secondary">{s.deniedIsins}</p>
          <textarea
            aria-label={s.deniedIsins}
            placeholder={s.tradeControlsIsinList}
            rows={3}
            value={denied}
            onChange={(e) => setDenied(e.target.value)}
            className={textarea}
          />
          <p className="text-xs text-text-tertiary">{s.tradeControlsDeniedHelp}</p>
        </div>

        <div className="space-y-1">
          <Input
            id="max-order-notional"
            label={`${s.maxOrderNotional} (EUR)`}
            inputMode="decimal"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            error={maxInvalid ? s.tradeControlsMaxHelp : undefined}
          />
          {!maxInvalid && <p className="text-xs text-text-tertiary">{s.tradeControlsMaxHelp}</p>}
        </div>

        {invalid && <p className="text-sm text-negative">{s.tradeControlsInvalidIsin(invalid)}</p>}
        {error && <p className="whitespace-pre-line text-sm text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button onClick={save} disabled={saving || Boolean(invalid) || maxInvalid}>
            {saving ? <Spinner size={16} className="mr-2" /> : null}
            {s.tradeControlsSave}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
