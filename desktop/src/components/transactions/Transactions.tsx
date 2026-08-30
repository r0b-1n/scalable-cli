import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card from "../ui/Card";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export default function Transactions() {
  const navigate = useNavigate();
  const { activePortfolioId } = useAppStore();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const loadTransactions = async (pageCursor?: string) => {
    setLoading(true);
    try {
      const result = await api.getTransactions({
        portfolioId: activePortfolioId || undefined,
        pageSize: 25,
        cursor: pageCursor || undefined,
        typeFilter: typeFilter ? [typeFilter] : undefined,
        searchTerm: searchTerm || undefined,
      });
      const data = result as any;
      setTransactions(data.transactions || []);
      setNextCursor(data.nextCursor || null);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [activePortfolioId, typeFilter, searchTerm]);

  const handleNext = () => {
    if (nextCursor) {
      setCursors((prev) => [...prev, cursor || ""]);
      setCursor(nextCursor);
      loadTransactions(nextCursor);
    }
  };

  const handlePrev = () => {
    if (cursors.length > 0) {
      const prevCursor = cursors[cursors.length - 1];
      setCursors((prev) => prev.slice(0, -1));
      setCursor(prevCursor || null);
      loadTransactions(prevCursor || undefined);
    }
  };

  const handleSearch = () => {
    setCursors([]);
    setCursor(null);
    setSearchTerm(searchInput);
  };

  const typeFilters = [
    { value: "", label: "All Types" },
    { value: "buy", label: "Buy" },
    { value: "sell", label: "Sell" },
    { value: "distribution", label: "Distribution" },
    { value: "savings_plan_execution", label: "Savings Plan" },
    { value: "interest", label: "Interest" },
    { value: "fee", label: "Fee" },
    { value: "transfer_in", label: "Transfer In" },
    { value: "transfer_out", label: "Transfer Out" },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Transactions</h1>
      </div>

      {/* Filters */}
      <div className="flex items-end gap-4">
        <div className="flex-1 max-w-xs">
          <Select
            options={typeFilters}
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setCursors([]);
              setCursor(null);
            }}
          />
        </div>
        <div className="flex-1 max-w-sm flex gap-2">
          <Input
            placeholder="Search transactions..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button variant="secondary" onClick={handleSearch} size="md">
            <Search size={16} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card padding={false}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={28} />
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-text-secondary">No transactions found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Date
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Type
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Security
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Quantity
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Price
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx: any) => (
                  <tr
                    key={tx.id}
                    className="border-b border-border/50 hover:bg-bg-card-hover transition-colors cursor-pointer"
                    onClick={() => navigate(`/transactions?id=${tx.id}`)}
                  >
                    <td className="px-5 py-3.5 text-sm text-text-secondary">
                      {formatDateTime(tx.date)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent-dim text-accent capitalize">
                        {tx.type?.replace(/_/g, " ") || "Unknown"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="text-sm text-text-primary">{tx.securityName || "—"}</p>
                        <p className="text-xs text-text-secondary">{tx.isin || "—"}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-text-primary">
                      {tx.quantity || "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-text-primary">
                      {tx.price ? formatCurrency(parseFloat(tx.price)) : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-medium text-text-primary">
                      {formatCurrency(parseFloat(tx.amount || "0"))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrev}
            disabled={cursors.length === 0}
          >
            <ChevronLeft size={16} className="mr-1" />
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNext}
            disabled={!nextCursor}
          >
            Next
            <ChevronRight size={16} className="ml-1" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
