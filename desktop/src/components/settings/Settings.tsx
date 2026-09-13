import { useCallback, useEffect, useState } from "react";
import {
  Monitor,
  Briefcase,
  User,
  Terminal,
  LogOut,
} from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n, type Language } from "../../i18n";
import { useToast } from "../ui/Toast";
import { renderCliCommand } from "../../lib/cliLog";
import { readThemePreference, setThemePreference, type ThemePreference } from "../../lib/theme";
import { CardHeader, CardTitle } from "../ui/Card";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Select from "../ui/Select";
import SegmentedControl from "../ui/SegmentedControl";
import Spinner from "../ui/Spinner";
import { SkeletonLines } from "../ui/Skeleton";
import CliCommand from "../ui/CliCommand";
import type { BrokerContextData, BrokerPortfolioListData, CapabilitiesData } from "../../api/types";

/**
 * Real shape of `capabilities.local_trade_controls`, taken from
 * `TradeControlsPolicy::capabilities_payload` in the CLI (`src/trade_controls.rs`).
 * The API type keeps this as `Record<string, unknown>` because the CLI forwards
 * it verbatim; this narrows it locally for readable rendering only.
 */
interface LocalTradeControls {
  enabled?: boolean;
  allowed_isins_configured?: boolean;
  denied_isins_configured?: boolean;
  max_order_notional_active?: boolean;
  allowed_isins?: string[];
  denied_isins?: string[];
  max_order_notional?: string | null;
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-text-secondary">{label}</span>
      {typeof children === "string" ? (
        <span className="text-sm font-medium text-text-primary">{children}</span>
      ) : (
        children
      )}
    </div>
  );
}

function IsinBadges({ isins }: { isins: string[] }) {
  if (isins.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1.5 py-2">
      {isins.map((isin) => (
        <Badge key={isin} className="font-mono">
          {isin}
        </Badge>
      ))}
    </div>
  );
}

export default function Settings() {
  const {
    user,
    activePortfolioId,
    setActivePortfolioId,
    setAuthenticated,
    setUser,
    refresh,
    refreshToken,
  } = useAppStore();
  const { t, lang, setLang } = useI18n();
  const { push } = useToast();

  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference());

  const [context, setContext] = useState<BrokerContextData | null>(null);
  const [portfolioList, setPortfolioList] = useState<BrokerPortfolioListData | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const [capabilities, setCapabilities] = useState<CapabilitiesData | null>(null);
  const [capLoading, setCapLoading] = useState(true);
  const [capError, setCapError] = useState<string | null>(null);

  const [loggingOut, setLoggingOut] = useState(false);

  const loadContext = useCallback(async () => {
    setContextLoading(true);
    setContextError(null);
    try {
      const [ctx, list] = await Promise.all([
        api.getBrokerContext(),
        api.listBrokerPortfolios(),
      ]);
      setContext(ctx);
      setPortfolioList(list);
      if (list.selected_portfolio_id) setActivePortfolioId(list.selected_portfolio_id);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setContextLoading(false);
    }
  }, [t.common.loadFailed, setActivePortfolioId]);

  const loadCapabilities = useCallback(async () => {
    setCapLoading(true);
    setCapError(null);
    try {
      setCapabilities(await api.getCapabilities());
    } catch (err) {
      setCapError(err instanceof Error ? err.message : t.settings.capabilitiesError);
    } finally {
      setCapLoading(false);
    }
  }, [t.settings.capabilitiesError]);

  useEffect(() => {
    loadContext();
  }, [loadContext, refreshToken, activePortfolioId]);

  useEffect(() => {
    loadCapabilities();
  }, [loadCapabilities, refreshToken, activePortfolioId]);

  const handleThemeChange = (pref: ThemePreference) => {
    setThemePreference(pref);
    setTheme(pref);
  };

  const switchPortfolio = async (portfolioId: string) => {
    if (switching || !portfolioId || portfolioId === activePortfolioId) return;
    setSwitching(true);
    try {
      await api.selectBrokerContext(portfolioId);
      // Update the store and let every mounted screen refetch — never reload
      // the window, that would blow away in-flight state across the app.
      setActivePortfolioId(portfolioId);
      refresh();
      push({ tone: "success", title: t.common.saved });
    } catch (err) {
      push({
        tone: "error",
        title: t.context.selectFailed,
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSwitching(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await api.logout();
    } catch {
      // A failed revoke still ends the local session; never trap the user.
    } finally {
      setAuthenticated(false);
      setUser(null);
    }
  };

  const person = user?.result?.personOverview;
  const trade = capabilities?.local_trade_controls as LocalTradeControls | undefined;
  const portfolios = portfolioList?.portfolios ?? [];
  const contextCommand = renderCliCommand("get_broker_context");
  const listPortfoliosCommand = renderCliCommand("list_broker_portfolios");
  const capabilitiesCommand = renderCliCommand("get_capabilities");

  return (
    <div className="max-w-3xl space-y-10">
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.settings.title}</h1>

      {/* Appearance */}
      <section>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Monitor size={14} className="text-text-tertiary" />
            <CardTitle>{t.settings.appearance}</CardTitle>
          </div>
        </CardHeader>
        <div className="divide-y divide-border">
          <SettingsRow label={t.theme.label}>
            <SegmentedControl<ThemePreference>
              options={[
                { value: "system", label: t.theme.system },
                { value: "light", label: t.theme.light },
                { value: "dark", label: t.theme.dark },
              ]}
              value={theme}
              onChange={handleThemeChange}
            />
          </SettingsRow>
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

      {/* Broker context */}
      <section>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Briefcase size={14} className="text-text-tertiary" />
            <CardTitle>{t.settings.portfolio}</CardTitle>
          </div>
        </CardHeader>
        <CliCommand
          commands={[contextCommand, listPortfoliosCommand]}
          variant="block"
          className="mb-3"
        />
        {contextLoading ? (
          <SkeletonLines rows={2} />
        ) : contextError ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-text-secondary">{contextError}</p>
            <Button variant="secondary" size="sm" onClick={loadContext}>
              {t.common.retry}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            <SettingsRow label={t.settings.portfolio}>
              <span className="font-mono text-xs text-text-secondary">
                {context?.context?.account_id ?? "—"}
                {" / "}
                {activePortfolioId ?? context?.context?.portfolio_id ?? "—"}
              </span>
            </SettingsRow>
            {portfolios.length > 1 && (
              <SettingsRow label={t.context.title}>
                <Select
                  options={portfolios.map((id) => ({ value: id, label: id }))}
                  value={activePortfolioId ?? ""}
                  disabled={switching}
                  onChange={(e) => switchPortfolio(e.target.value)}
                  className="w-56 font-mono"
                />
              </SettingsRow>
            )}
          </div>
        )}
      </section>

      {/* Session */}
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
              {`${person.personalDetails?.firstName ?? ""} ${person.personalDetails?.lastName ?? ""}`.trim() ||
                "—"}
            </SettingsRow>
            {person.locale && <SettingsRow label={t.settings.locale}>{person.locale}</SettingsRow>}
            <SettingsRow label={t.settings.userId}>
              <span className="font-mono text-xs text-text-secondary">{person.id}</span>
            </SettingsRow>
          </div>
        )}
        <div className="pt-4">
          <Button variant="danger" size="sm" onClick={handleLogout} disabled={loggingOut}>
            <span className="flex items-center gap-1.5">
              {loggingOut ? <Spinner size={14} /> : <LogOut size={14} />}
              {t.nav.logout}
            </span>
          </Button>
        </div>
      </section>

      {/* CLI info */}
      <section>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-text-tertiary" />
            <CardTitle>{t.settings.cliCapabilities}</CardTitle>
          </div>
        </CardHeader>
        <CliCommand commands={capabilitiesCommand} className="mb-3" />
        {capLoading ? (
          <SkeletonLines rows={4} />
        ) : capError ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-text-secondary">{capError}</p>
            <Button variant="secondary" size="sm" onClick={loadCapabilities}>
              {t.common.retry}
            </Button>
          </div>
        ) : capabilities ? (
          <div className="divide-y divide-border">
            <SettingsRow label={t.settings.cliVersion}>{capabilities.version}</SettingsRow>
            {trade && (
              <>
                <SettingsRow label={t.settings.localTradeControls}>
                  <Badge variant={trade.enabled ? "positive" : "default"}>
                    {trade.enabled ? t.settings.enabled : t.settings.disabled}
                  </Badge>
                </SettingsRow>
                {trade.max_order_notional_active && trade.max_order_notional && (
                  <SettingsRow label={t.settings.maxOrderNotional}>
                    {`${trade.max_order_notional} EUR`}
                  </SettingsRow>
                )}
                {trade.allowed_isins_configured && (
                  <div className="py-1">
                    <SettingsRow label={t.settings.allowedIsins}>
                      {t.settings.configured(trade.allowed_isins?.length ?? 0)}
                    </SettingsRow>
                    <IsinBadges isins={trade.allowed_isins ?? []} />
                  </div>
                )}
                {trade.denied_isins_configured && (
                  <div className="py-1">
                    <SettingsRow label={t.settings.deniedIsins}>
                      {t.settings.configured(trade.denied_isins?.length ?? 0)}
                    </SettingsRow>
                    <IsinBadges isins={trade.denied_isins ?? []} />
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">{t.settings.capabilitiesError}</p>
        )}
      </section>
    </div>
  );
}
