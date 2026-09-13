import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import { api } from "../../api/client";
import { renderCliCommand } from "../../lib/cliLog";
import Button from "../ui/Button";
import CliCommand from "../ui/CliCommand";
import { SkeletonLines } from "../ui/Skeleton";
import type { CapabilitiesData } from "../../api/types";
import CapabilitiesPanel from "./CapabilitiesPanel";
import SessionLog from "./SessionLog";

/**
 * Composite screen: the CLI's full declared capability surface
 * (`sc capabilities --json`) plus this session's command log — together
 * the auditable half of "the CLI is the product". Nothing here is derived
 * or summarized: every command name, exit code and two-phase workflow rule
 * is rendered as the CLI reports it.
 */
export default function CliConsole() {
  const { refreshToken, activePortfolioId } = useAppStore();
  const { t } = useI18n();

  const [capabilities, setCapabilities] = useState<CapabilitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCapabilities(await api.getCapabilities());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.common.loadFailed]);

  useEffect(() => {
    load();
    // activePortfolioId doesn't change what the CLI declares, but every
    // screen refetches on a portfolio switch for consistency with the header.
  }, [load, refreshToken, activePortfolioId]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.cli.title}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t.cli.subtitle}</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-base font-semibold tracking-tight text-text-primary">
          {t.cli.capabilities}
        </h2>
        <CliCommand commands={renderCliCommand("get_capabilities")} />
        {loading ? (
          <SkeletonLines rows={8} />
        ) : error ? (
          <div className="space-y-3 py-4">
            <p className="text-sm text-text-secondary">{error}</p>
            <Button variant="secondary" size="sm" onClick={load}>
              {t.common.retry}
            </Button>
          </div>
        ) : capabilities ? (
          <CapabilitiesPanel capabilities={capabilities} />
        ) : null}
      </section>

      <SessionLog />

      <p className="text-2xs leading-relaxed text-text-tertiary">{t.cli.hint}</p>
    </div>
  );
}
