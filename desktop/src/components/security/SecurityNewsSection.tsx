import { useEffect, useState } from "react";
import { Newspaper } from "lucide-react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";
import { renderCliCommand } from "../../lib/cliLog";
import { formatDate } from "../../lib/format";
import { CardHeader, CardTitle } from "../ui/Card";
import { SkeletonLines } from "../ui/Skeleton";
import EmptyState from "../ui/EmptyState";
import CliCommand from "../ui/CliCommand";
import type { NewsLocale, SecurityNewsData } from "../../api/types";

interface SecurityNewsSectionProps {
  isin: string;
  locale: NewsLocale;
}

/** `sc broker security-news` — summary plus sourced headlines, in the UI's
 * own language so this reads the same as everything else on screen. */
export default function SecurityNewsSection({ isin, locale }: SecurityNewsSectionProps) {
  const { t } = useI18n();
  const [news, setNews] = useState<SecurityNewsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getSecurityNews(isin, locale)
      .then((data) => {
        if (!cancelled) setNews(data);
      })
      .catch(() => {
        if (!cancelled) setNews(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isin, locale]);

  const sources = news?.sources ?? [];

  return (
    <section>
      <CardHeader>
        <CardTitle>{t.security.latestNews}</CardTitle>
      </CardHeader>
      {loading ? (
        <SkeletonLines rows={4} />
      ) : sources.length === 0 && !news?.summary?.short ? (
        <EmptyState icon={<Newspaper size={18} />} title={t.search.noResults} className="py-8" />
      ) : (
        <>
          {news?.summary?.short && <p className="mb-4 text-sm text-text-secondary">{news.summary.short}</p>}
          <div className="divide-y divide-border">
            {sources.slice(0, 8).map((item, i) => (
              <div key={item.id || i} className="py-3.5">
                <h4 className="text-sm font-medium text-text-primary">{item.headline}</h4>
                <div className="mt-1.5 flex items-center gap-3">
                  {item.source_name && <span className="text-2xs text-accent">{item.source_name}</span>}
                  {item.publication_time_utc && (
                    <span className="text-2xs text-text-tertiary">{formatDate(item.publication_time_utc)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <CliCommand commands={renderCliCommand("get_security_news", { isin, locale })} className="mt-3" />
    </section>
  );
}
