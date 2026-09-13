import { useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import Badge from "../ui/Badge";
import { ScalableLogo } from "../brand/Logo";
import { LogIn, Shield, Wifi, Lock, AlertCircle } from "lucide-react";

export default function AuthScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `--local-read-only`: a purely local guard the CLI enforces on this
  // machine — it blocks write commands before they leave the process, but
  // does not change what the underlying OAuth token is allowed to do.
  const [readOnly, setReadOnly] = useState(false);
  const { setAuthenticated, setUser } = useAppStore();
  const { t } = useI18n();

  const handleLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await api.login(readOnly);
      const user = await api.getWhoami();
      setUser(user);
      setAuthenticated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.loginFailed);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <div className="w-full max-w-sm px-6 animate-slide-up">
        <div className="text-center mb-10">
          <div className="mb-6 flex justify-center text-text-primary">
            <ScalableLogo className="h-8 w-auto" />
          </div>
          <p className="text-sm text-text-secondary">{t.auth.tagline}</p>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl shadow-modal p-6 space-y-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 p-1.5 rounded-lg bg-accent-dim">
                <Shield size={16} className="text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-primary">{t.auth.secureAuthTitle}</h3>
                <p className="text-xs text-text-secondary mt-0.5">{t.auth.secureAuthBody}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 p-1.5 rounded-lg bg-accent-dim">
                <Wifi size={16} className="text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-primary">{t.auth.sharedSessionTitle}</h3>
                <p className="text-xs text-text-secondary mt-0.5">{t.auth.sharedSessionBody}</p>
              </div>
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-bg-inset px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm text-text-primary">
              <Lock size={14} className="shrink-0 text-text-tertiary" />
              {t.cli.tradeControls}
            </span>
            <span className="flex items-center gap-2">
              <Badge variant={readOnly ? "positive" : "default"}>
                {readOnly ? t.settings.enabled : t.settings.disabled}
              </Badge>
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
                aria-label={t.cli.tradeControls}
                className="h-4 w-4 cursor-pointer accent-accent"
              />
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-negative/10 border border-negative/20 rounded-lg">
              <AlertCircle size={16} className="text-negative mt-0.5 shrink-0" />
              <p className="text-xs text-negative">{error}</p>
            </div>
          )}

          <Button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full"
            size="lg"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Spinner size={16} className="text-on-accent" />
                {t.auth.authenticating}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <LogIn size={18} />
                {t.auth.signIn}
              </span>
            )}
          </Button>

          <p className="text-2xs text-text-tertiary text-center leading-relaxed">{t.auth.hint}</p>
        </div>
      </div>
    </div>
  );
}
