import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Badge from "../ui/Badge";
import { Settings as SettingsIcon, User, Shield, Terminal } from "lucide-react";

export default function Settings() {
  const { user } = useAppStore();
  const [capabilities, setCapabilities] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const caps = await api.getCapabilities();
        setCapabilities(caps);
      } catch {
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-text-primary">Settings</h1>

      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User size={16} className="text-accent" />
            <CardTitle>Profile</CardTitle>
          </div>
        </CardHeader>
        <div className="space-y-3">
          {user?.personOverview && (
            <>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-text-secondary">Name</span>
                <span className="text-sm font-medium text-text-primary">
                  {user.personOverview.firstName} {user.personOverview.lastName}
                </span>
              </div>
              {user.personOverview.email && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-text-secondary">Email</span>
                  <span className="text-sm font-medium text-text-primary">
                    {user.personOverview.email}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-text-secondary">User ID</span>
                <span className="text-xs font-mono text-text-secondary">
                  {user.personOverview.id}
                </span>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Capabilities */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-accent" />
            <CardTitle>CLI Capabilities</CardTitle>
          </div>
        </CardHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size={20} />
          </div>
        ) : capabilities ? (
          <div className="space-y-3">
            {capabilities.commands && (
              <div>
                <p className="text-sm text-text-secondary mb-2">Available Commands</p>
                <div className="flex flex-wrap gap-1.5">
                  {capabilities.commands.map((cmd: string) => (
                    <Badge key={cmd} variant="accent">
                      {cmd}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {capabilities.localTradeControls && (
              <div className="pt-3 border-t border-border">
                <p className="text-sm text-text-secondary mb-2">Local Trade Controls</p>
                <div className="space-y-1">
                  {capabilities.localTradeControls.maxOrderNotional && (
                    <p className="text-xs text-text-secondary">
                      Max order: {capabilities.localTradeControls.maxOrderNotional} EUR
                    </p>
                  )}
                  {capabilities.localTradeControls.allowedIsins?.length > 0 && (
                    <p className="text-xs text-text-secondary">
                      Allowed ISINs: {capabilities.localTradeControls.allowedIsins.length} configured
                    </p>
                  )}
                  {capabilities.localTradeControls.deniedIsins?.length > 0 && (
                    <p className="text-xs text-text-secondary">
                      Denied ISINs: {capabilities.localTradeControls.deniedIsins.length} configured
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">Unable to load capabilities</p>
        )}
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-accent" />
            <CardTitle>Security</CardTitle>
          </div>
        </CardHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">Session Storage</span>
            <Badge variant="accent">Platform Keyring</Badge>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">Signing Key</span>
            <Badge variant="accent">Secure Enclave</Badge>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">Trade Confirmation</span>
            <Badge variant="positive">Two-Step Verification</Badge>
          </div>
        </div>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <div className="space-y-2 text-sm text-text-secondary">
          <p>Scalable Desktop v1.0.0</p>
          <p>Built on top of Scalable CLI</p>
          <p className="text-xs text-text-secondary/60 pt-2">
            This desktop app wraps the official Scalable CLI binary. All operations
            use the same secure authentication and API layer.
          </p>
        </div>
      </Card>
    </div>
  );
}
