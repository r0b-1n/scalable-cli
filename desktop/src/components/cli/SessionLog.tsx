import { useEffect, useState } from "react";
import { Trash2, Terminal } from "lucide-react";
import { useI18n } from "../../i18n";
import { getCliCalls, subscribeCliCalls, clearCliCalls, type CliCall } from "../../lib/cliLog";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import EmptyState from "../ui/EmptyState";
import { CopyButton } from "../ui/CliCommand";
import DataTable, { type Column } from "../ui/DataTable";

/**
 * Every `sc` invocation this session has made, from `lib/cliLog.ts`'s
 * in-memory log — the same log every screen's `CliCommand` reads from.
 */
export default function SessionLog() {
  const { t } = useI18n();
  const [calls, setCalls] = useState<CliCall[]>(() => getCliCalls());

  useEffect(() => {
    const unsubscribe = subscribeCliCalls(setCalls);
    return unsubscribe;
  }, []);

  const columns: Column<CliCall>[] = [
    {
      key: "cli",
      header: t.cli.command,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-1">
          <code className="truncate font-mono text-xs text-text-primary">{row.cli}</code>
          <CopyButton value={row.cli} />
        </div>
      ),
      sortValue: (row) => row.cli,
      exportValue: (row) => row.cli,
    },
    {
      key: "ok",
      header: t.cli.ok,
      cell: (row) => (
        <Badge variant={row.ok ? "positive" : "negative"}>{row.ok ? t.cli.ok : t.cli.failed}</Badge>
      ),
      sortValue: (row) => (row.ok ? 1 : 0),
      exportValue: (row) => (row.ok ? t.cli.ok : t.cli.failed),
    },
    {
      key: "duration",
      header: t.cli.duration,
      cell: (row) => <span className="tabular-nums">{row.durationMs} ms</span>,
      sortValue: (row) => row.durationMs,
      exportValue: (row) => row.durationMs,
      align: "right",
    },
    {
      key: "error",
      header: <code className="normal-case">error</code>,
      cell: (row) => (row.error ? <span className="text-xs text-negative">{row.error}</span> : null),
      exportValue: (row) => row.error ?? "",
      hideNarrow: true,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-text-primary">
          <Terminal size={16} className="text-text-tertiary" />
          {t.cli.log}
        </h2>
        {calls.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearCliCalls}>
            <Trash2 size={13} className="mr-1.5" />
            {t.cli.clearLog}
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={calls}
        rowKey={(row) => String(row.id)}
        empty={<EmptyState icon={<Terminal size={20} />} title={t.cli.logEmpty} />}
        exportName="cli-session-log"
      />
    </section>
  );
}
