import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from "lucide-react";
import { cn } from "../../lib/utils";
import { SkeletonTable } from "./Skeleton";
import EmptyState from "./EmptyState";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  /** Sort key. Omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Value used for CSV export; falls back to `sortValue`. */
  exportValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  className?: string;
  /** Hide below ~1100px to keep narrow windows readable. */
  hideNarrow?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  /** Enables the CSV export button; used as the download file name. */
  exportName?: string;
  initialSort?: { key: string; direction: "asc" | "desc" };
  className?: string;
  /** Rendered between the export button and the table, e.g. filters. */
  toolbar?: ReactNode;
}

function compare(a: unknown, b: unknown): number {
  // Nulls sort last regardless of direction so empty cells never lead.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const value = (col: Column<T>, row: T) => {
    const raw = (col.exportValue ?? col.sortValue)?.(row);
    if (raw == null) return "";
    const text = String(raw);
    // Quote anything a spreadsheet would otherwise split or mangle.
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const exportable = columns.filter((c) => c.exportValue ?? c.sortValue);
  const header = exportable
    .map((c) => (typeof c.header === "string" ? c.header : c.key))
    .join(",");
  return [header, ...rows.map((row) => exportable.map((c) => value(c, row)).join(","))].join("\n");
}

/**
 * Sortable table with optional CSV export.
 *
 * Export writes a Blob through an object URL rather than a `data:` URI: the
 * app's CSP allows neither remote fetches nor inline data documents, and blob
 * URLs stay same-origin.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  empty,
  exportName,
  initialSort,
  className,
  toolbar,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(
    initialSort ?? null
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    // Copy first: sorting the prop array in place would mutate the caller's state.
    return [...rows].sort((a, b) => factor * compare(col.sortValue!(a), col.sortValue!(b)));
  }, [rows, sort, columns]);

  const toggleSort = (key: string) => {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" }
    );
  };

  const download = () => {
    const blob = new Blob([toCsv(columns, sorted)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-bg-card", className)}>
      {(toolbar || exportName) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {exportName && rows.length > 0 && (
            <button
              onClick={download}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-2xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            >
              <Download size={13} />
              CSV
            </button>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonTable cols={columns.length} />
      ) : sorted.length === 0 ? (
        <div className="p-6">{empty ?? <EmptyState title="—" description="" />}</div>
      ) : (
        // `@container` so `hideNarrow` reacts to the width the table actually
        // has, not the viewport's — the sidebar and page gutters take ~300px,
        // so a viewport breakpoint shows columns that then overflow.
        <div className="@container overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => {
                  const active = sort?.key === col.key;
                  const sortable = Boolean(col.sortValue);
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={
                        active
                          ? sort!.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      className={cn(
                        "px-4 py-2.5 text-2xs font-medium tracking-[0.06em] text-text-tertiary uppercase",
                        col.align === "right" ? "text-right" : "text-left",
                        col.hideNarrow && "hidden @6xl:table-cell"
                      )}
                    >
                      {sortable ? (
                        <button
                          onClick={() => toggleSort(col.key)}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-text-primary",
                            col.align === "right" && "flex-row-reverse",
                            active && "text-text-primary"
                          )}
                        >
                          {col.header}
                          {active ? (
                            sort!.direction === "asc" ? (
                              <ArrowUp size={11} />
                            ) : (
                              <ArrowDown size={11} />
                            )
                          ) : (
                            <ChevronsUpDown size={11} className="opacity-40" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "border-b border-border/60 last:border-0",
                    onRowClick && "cursor-pointer transition-colors hover:bg-hover"
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 text-text-primary",
                        col.align === "right" && "text-right tabular-nums",
                        col.hideNarrow && "hidden @6xl:table-cell",
                        col.className
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
