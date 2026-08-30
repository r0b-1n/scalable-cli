import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Spinner from "../ui/Spinner";
import { Search, X, ArrowRight } from "lucide-react";

interface SearchModalProps {
  onClose: () => void;
}

export default function SearchModal({ onClose }: SearchModalProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.search(query);
        setResults((data as any).results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (isin: string) => {
    navigate(`/security/${isin}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="w-full max-w-xl mx-4 bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={18} className="text-text-secondary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search securities by name or ISIN..."
            className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-secondary/60 focus:outline-none"
          />
          {loading && <Spinner size={16} />}
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[300px] overflow-y-auto">
          {results.length === 0 && query.trim() && !loading ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-text-secondary">No results found</p>
            </div>
          ) : (
            <div className="py-2">
              {results.map((r: any) => (
                <button
                  key={r.isin}
                  onClick={() => handleSelect(r.isin)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-card transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-bg-card flex items-center justify-center text-xs font-bold text-text-secondary">
                      {(r.name || r.isin).charAt(0)}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-text-primary">{r.name}</p>
                      <p className="text-xs text-text-secondary">{r.isin}</p>
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-text-secondary" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border">
          <p className="text-[11px] text-text-secondary">
            Press <kbd className="px-1 py-0.5 bg-bg-card rounded border border-border">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}
