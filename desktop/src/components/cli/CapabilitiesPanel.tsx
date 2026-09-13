import { KeyRound, ListOrdered, Hash, Layers, ShieldCheck } from "lucide-react";
import { useI18n } from "../../i18n";
import { CardHeader, CardTitle } from "../ui/Card";
import Badge from "../ui/Badge";
import type { CapabilitiesData } from "../../api/types";
import {
  Field,
  BoolIcon,
  MonoChips,
  PanelCard,
  type LocalTradeControls,
} from "./shared";
import WorkflowsPanel from "./WorkflowsPanel";

/**
 * Full readout of `sc capabilities --json` — the exact command surface,
 * exit codes and two-phase disclosure rules this build of the CLI enforces.
 * Raw JSON field names are kept in monospace rather than translated: they
 * are the CLI's own vocabulary, not app copy, and translating them would
 * make this screen lie about what the CLI actually reports.
 */
export default function CapabilitiesPanel({ capabilities }: { capabilities: CapabilitiesData }) {
  const { t } = useI18n();
  const trade = capabilities.local_trade_controls as LocalTradeControls | undefined;
  const metadataEntries = Object.entries(capabilities.command_metadata ?? {});

  return (
    <div className="space-y-8">
      <div>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound size={14} className="text-text-tertiary" />
            <CardTitle>{t.cli.version}</CardTitle>
          </div>
        </CardHeader>
        <PanelCard>
          <Field name="version">
            <span className="text-sm font-medium text-text-primary">{capabilities.version}</span>
          </Field>
          <Field name="output">
            <Badge variant="accent">{capabilities.output}</Badge>
          </Field>
          <Field name="auth.modes">
            <MonoChips items={capabilities.auth.modes} />
          </Field>
          <Field name="auth.non_interactive_modes">
            <MonoChips items={capabilities.auth.non_interactive_modes} />
          </Field>
        </PanelCard>
      </div>

      <div>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ListOrdered size={14} className="text-text-tertiary" />
            <CardTitle>
              {t.cli.commands} ({capabilities.commands.length})
            </CardTitle>
          </div>
        </CardHeader>
        <div className="flex flex-wrap gap-1.5 rounded-2xl border border-border bg-bg-card p-4">
          <MonoChips items={capabilities.commands} />
        </div>
        {metadataEntries.length > 0 && (
          <PanelCard className="mt-3">
            {metadataEntries.map(([cmd, meta]) => (
              <Field key={cmd} name={cmd}>
                <span className="flex items-center gap-1 text-2xs text-text-tertiary">
                  <code>human_only</code>
                  <BoolIcon value={meta?.human_only} />
                </span>
                <span className="flex items-center gap-1 text-2xs text-text-tertiary">
                  <code>json_supported</code>
                  <BoolIcon value={meta?.json_supported ?? true} />
                </span>
              </Field>
            ))}
          </PanelCard>
        )}
      </div>

      <div>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Hash size={14} className="text-text-tertiary" />
            <CardTitle>{t.cli.exitCodes}</CardTitle>
          </div>
        </CardHeader>
        <PanelCard>
          {Object.entries(capabilities.exit_codes).map(([name, code]) => (
            <Field key={name} name={name}>
              <span className="tabular-nums text-sm font-medium text-text-primary">{code}</span>
            </Field>
          ))}
        </PanelCard>
      </div>

      <div>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-text-tertiary" />
            <CardTitle>{t.cli.workflows}</CardTitle>
          </div>
        </CardHeader>
        <WorkflowsPanel workflows={capabilities.workflows} />
      </div>

      {trade && (
        <div>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-text-tertiary" />
              <CardTitle>{t.cli.tradeControls}</CardTitle>
            </div>
          </CardHeader>
          <PanelCard>
            <Field name="enabled">
              <Badge variant={trade.enabled ? "positive" : "default"}>
                {trade.enabled ? t.settings.enabled : t.settings.disabled}
              </Badge>
            </Field>
            <Field name="max_order_notional">
              {trade.max_order_notional_active && trade.max_order_notional ? (
                <span className="tabular-nums text-sm font-medium text-text-primary">
                  {trade.max_order_notional} EUR
                </span>
              ) : (
                <BoolIcon value={false} />
              )}
            </Field>
            <Field name="allowed_isins">
              {trade.allowed_isins_configured ? (
                <MonoChips items={trade.allowed_isins ?? []} />
              ) : (
                <BoolIcon value={false} />
              )}
            </Field>
            <Field name="denied_isins">
              {trade.denied_isins_configured ? (
                <MonoChips items={trade.denied_isins ?? []} />
              ) : (
                <BoolIcon value={false} />
              )}
            </Field>
            <Field name="isin_resolution">
              <span className="font-mono text-2xs text-text-secondary">
                {trade.isin_resolution ?? "—"}
              </span>
            </Field>
            <Field name="enforced_on">
              <MonoChips items={trade.enforced_on ?? []} />
            </Field>
          </PanelCard>
        </div>
      )}
    </div>
  );
}
