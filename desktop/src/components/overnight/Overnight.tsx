import { useEffect, useState } from "react";
import { api } from "../../api/client";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { Moon, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight } from "lucide-react";

export default function Overnight() {
  const [data, setData] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await api.getOvernight();
        setData(result);
      } catch {
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const loadTransactions = async (pageCursor?: string) => {
    setTxLoading(true);
    try {
      const result = await api.getOvernightTransactions({
        pageSize: 20,
        cursor: pageCursor || undefined,
        typeFilter: typeFilter ? [typeFilter] : undefined,
      });
      const txData = result as any;
      setTransactions(txData.transactions || []);
      setNextCursor(txData.nextCursor || null);
    } catch {
    } finally {
      setTxLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [typeFilter]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={32} />
      </div>
    );
  }

  const typeFilters = [
    { value: "", label: "All Types" },
    { value: "deposit", label: "Deposit" },
    { value: "withdrawal", label: "Withdrawal" },
    { value: "interest", label: "Interest" },
    { value: "fee", label: "Fee" },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <h1 className="text-2xl font-bold text-text-primary">Overnight Savings</h1>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-text-secondary">
              <Moon size={16} />
              <p className="text-sm">Balance</p>
            </div>
            <p className="text-2xl font-bold text-text-primary">
              {formatCurrency(parseFloat(data?.balance || "0"))}
            </p>
          </div>
        </Card>
        <Card>
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">Interest Rate</p>
            <p className="text-2xl font-bold text-accent">
              {data?.interestRate || "—"}% p.a.
            </p>
          </div>
        </Card>
        <Card>
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">IBAN</p>
            <p className="text-sm font-medium text-text-primary">
              {data?.iban || "—"}
            </p>
          </div>
        </Card>
      </div>

      {/* Transactions */}
      <Card padding={false}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            Transactions
          </h2>
          <Select
            options={typeFilters}
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setCursors([]);
              setCursor(null);
            }}
            className="w-40"
          />
        </div>
        {txLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={24} />
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-text-secondary">No transactions found</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {transactions.map((tx: any) => {
              const amount = parseFloat(tx.amount || "0");
              const isCredit = amount >= 0;
              return (
                <div key={tx.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-bg-card-hover transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isCredit ? "bg-positive/15" : "bg-negative/15"}`}>
                      {isCredit ? (
                        <ArrowUpRight size={14} className="text-positive" />
                      ) : (
                        <ArrowDownRight size={14} className="text-negative" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        {tx.description || tx.type?.replace(/_/g, " ") || "Transaction"}
                      </p>
                      <p className="text-xs text-text-secondary">{formatDateTime(tx.date)}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-medium ${isCredit ? "text-positive" : "text-negative"}`}>
                    {isCredit ? "+" : ""}{formatCurrency(Math.abs(amount))}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={handlePrev} disabled={cursors.length === 0}>
            <ChevronLeft size={16} className="mr-1" />
            Previous
          </Button>
          <Button variant="ghost" size="sm" onClick={handleNext} disabled={!nextCursor}>
            Next
            <ChevronRight size={16} className="ml-1" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
