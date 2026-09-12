import { useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import { LogIn, Shield, Wifi, AlertCircle } from "lucide-react";

export default function AuthScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setAuthenticated, setUser } = useAppStore();
  const { t } = useI18n();

  const handleLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await api.login();
      const user = await api.getWhoami();
      setUser(user);
      setAuthenticated(true);
    } catch (err: any) {
      setError(err?.message || t.auth.loginFailed);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <div className="w-full max-w-sm px-6 animate-slide-up">
        <div className="text-center mb-10">
          <div className="w-14 h-14 mx-auto mb-6 rounded-2xl bg-accent flex items-center justify-center">
            <span className="text-bg-primary font-bold text-xl">S</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary mb-2">
            Scalable Desktop
          </h1>
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
                <Spinner size={16} className="text-bg-primary" />
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
