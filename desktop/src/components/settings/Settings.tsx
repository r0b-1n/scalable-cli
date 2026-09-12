import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Badge from "../ui/Badge";
import SegmentedControl from "../ui/SegmentedControl";
import Select from "../ui/Select";
import { useI18n, type Language } from "../../i18n";
import { User, Shield, Terminal, Globe } from "lucide-react";

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-text-secondary">{label}</span>
      {typeof children === "string" ? (
        <span className="text-sm font-medium text-text-primary">{children}</span>
      ) : (
        children
      )}
    </div>
  );
}

export default function Settings() {
  const { user, activePortfolioId, setActivePortfolioId } = useAppStore();
  const { t, lang, setLang } = useI18n();
  const [capabilities, setCapabilities] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [portfolios, setPortfolios] = useState<string[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const caps = await api.getCapabilities();
        setCapabilities(caps);
      } catch {
      } finally {
        setLoading(false);
      }
      try {
        const list = await api.listBrokerPortfolios();
        setPortfolios(list?.portfolios ?? []);
        if (list?.selected_portfolio_id) setActivePortfolioId(list.selected_portfolio_id);
      } catch {}
    };
    load();
  }, []);

  const switchPortfolio = async (portfolioId: string) => {
    if (switching || !portfolioId || portfolioId === activePortfolioId) return;
    setSwitching(true);
    try {
      await api.selectBrokerContext(portfolioId);
      setActivePortfolioId(portfolioId);
      // Every view caches data for the previous portfolio — reload cleanly.
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  };

  const person = user?.result?.personOverview;
  const trade = capabilities?.local_trade_controls;

  return (
    <div className="space-y-10 max-w-3xl">
      <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t.settings.title}</h1>

      {/* Appearance */}
      <section>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-text-tertiary" />
            <CardTitle>{t.settings.appearance}</CardTitle>
          </div>
        </CardHeader>
        <div className="divide-y divide-border">
          <SettingsRow label={t.settings.language}>
            <SegmentedControl<Language>
              options={[
                { value: "de", label: "Deutsch" },
                { value: "en", label: "English" },
              ]}
              value={lang}
              onChange={setLang}
            />
          </SettingsRow>
        </div>
      </section>

      {/* Profile */}
      <section>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User size={14} className="text-text-tertiary" />
            <CardTitle>{t.settings.profile}</CardTitle>
          </div>
        </CardHeader>
        {person && (
          <div className="divide-y divide-border">
            <SettingsRow label={t.settings.name}>
              {`${person.personalDetails?.firstName ?? ""} ${person.personalDetails?.lastName ?? ""}`.trim() || "—"}
            </SettingsRow>
            {portfolios.length > 1 ? (
              <SettingsRow label={t.settings.portfolio}>
                <Select
                  options={portfolios.map((id) => ({ value: id, label: id }))}
                  value={activePortfolioId ?? ""}
                  disabled={switching}
                  onChange={(e) => switchPortfolio(e.target.value)}
                  className="w-56"
                />
              </SettingsRow>
            ) : (
              activePortfolioId && (
                <SettingsRow label={t.settings.portfolio}>
                  <span className="text-xs font-mono text-text-secondary">{activePortfolioId}</span>
                </SettingsRow>
              )
            )}
            {person.locale && <SettingsRow label={t.settings.locale}>{person.locale}</SettingsRow>}
            <SettingsRow label={t.settings.userId}>
              <span className="text-xs font-mono text-text-secondary">{person.id}</span>
            </SettingsRow>
          </div>
        )}
      </section>

      {/* Capabilities */}
      <section>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-text-tertiary" />
            <CardTitle>{t.settings.cliCapabilities}</CardTitle>
          </div>
        </CardHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size={20} />
          </div>
        ) : capabilities ? (
          <div className="divide-y divide-border">
            {capabilities.version && (
              <SettingsRow label={t.settings.cliVersion}>{String(capabilities.version)}</SettingsRow>
            )}
            {capabilities.commands && (
              <div className="py-3">
                <p className="text-sm text-text-secondary mb-2.5">
                  {t.settings.availableCommands(capabilities.commands.length)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {capabilities.commands.map((cmd: string) => (
                    <Badge key={cmd}>{cmd}</Badge>
                  ))}
                </div>
              </div>
            )}
            {trade && (
              <>
                <SettingsRow label={t.settings.localTradeControls}>
                  <Badge variant={trade.enabled ? "positive" : "default"}>
                    {trade.enabled ? t.settings.enabled : t.settings.disabled}
                  </Badge>
                </SettingsRow>
                {trade.max_order_notional && (
                  <SettingsRow label={t.settings.maxOrderNotional}>
                    {`${trade.max_order_notional} EUR`}
                  </SettingsRow>
                )}
                {trade.allowed_isins_configured && (
                  <SettingsRow label={t.settings.allowedIsins}>
                    {t.settings.configured(trade.allowed_isins?.length ?? 0)}
                  </SettingsRow>
                )}
                {trade.denied_isins_configured && (
                  <SettingsRow label={t.settings.deniedIsins}>
                    {t.settings.configured(trade.denied_isins?.length ?? 0)}
                  </SettingsRow>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">{t.settings.capabilitiesError}</p>
        )}
      </section>

      {/* Security */}
      <section>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-text-tertiary" />
            <CardTitle>{t.settings.security}</CardTitle>
          </div>
        </CardHeader>
        <div className="divide-y divide-border">
          <SettingsRow label={t.settings.sessionStorage}>
            <Badge>{t.settings.platformKeyring}</Badge>
          </SettingsRow>
          <SettingsRow label={t.settings.transport}>
            <Badge>{t.settings.httpsOnly}</Badge>
          </SettingsRow>
          <SettingsRow label={t.settings.tradeConfirmation}>
            <Badge variant="positive">{t.settings.twoStep}</Badge>
          </SettingsRow>
        </div>
      </section>

      {/* About */}
      <section>
        <CardHeader>
          <CardTitle>{t.settings.about}</CardTitle>
        </CardHeader>
        <div className="space-y-1.5 text-sm text-text-secondary">
          <p className="text-text-primary font-medium">Scalable Desktop v1.0.0</p>
          <p>{t.settings.aboutBuiltOn}</p>
          <p className="text-2xs text-text-tertiary pt-2 leading-relaxed">{t.settings.aboutText}</p>
        </div>
      </section>
    </div>
  );
}
