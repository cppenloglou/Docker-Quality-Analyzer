import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { Layout } from "../components/Layout";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  ApiError,
  apiKeys as apiKeysApi,
  type ApiKey,
} from "../utils/api";

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [freshlyCreated, setFreshlyCreated] = useState<{
    id: string;
    key: string;
    key_prefix: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiKeysApi.list();
      setKeys(list);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load keys.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await apiKeysApi.create();
      setFreshlyCreated(result);
      toast.success("API key created. Copy it now - it will not be shown again.");
      await loadKeys();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to create key.";
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const confirmed = window.confirm(
      "Revoke this API key? Any clients using it will stop working immediately.",
    );
    if (!confirmed) return;
    setRevokingId(id);
    try {
      await apiKeysApi.revoke(id);
      toast.success("API key revoked");
      setKeys((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to revoke key.";
      toast.error(message);
    } finally {
      setRevokingId(null);
    }
  };

  const copyFreshKey = async () => {
    if (!freshlyCreated) return;
    try {
      await navigator.clipboard.writeText(freshlyCreated.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success("Key copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable - copy manually");
    }
  };

  const prefixBlocks = useMemo(
    () =>
      keys.map((key) => ({
        ...key,
        created: new Date(key.created_at).toLocaleString(),
      })),
    [keys],
  );

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
              <KeyRound className="w-7 h-7 text-blue-400" /> API Keys
            </h1>
            <p className="text-slate-400">
              Create long-lived API keys to authenticate requests without a JWT.
            </p>
          </div>
          <Button
            onClick={handleCreate}
            disabled={creating}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {creating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            Create new key
          </Button>
        </div>

        <Card className="p-5 bg-blue-500/5 border-blue-500/30 mb-6">
          <h2 className="text-sm font-semibold text-blue-200 mb-2">Usage</h2>
          <p className="text-sm text-slate-300">
            Send the key in an <code className="font-mono">X-Api-Key</code> request
            header instead of an <code className="font-mono">Authorization</code>{" "}
            bearer token. Example:
          </p>
          <pre className="mt-3 p-3 rounded bg-slate-950 border border-slate-800 text-xs text-slate-300 overflow-auto">
            curl -H "X-Api-Key: dpa_XXXXXX" {" "}
            https://example.com/api/v1/users/me/history
          </pre>
        </Card>

        {freshlyCreated && (
          <Card className="p-5 bg-emerald-500/5 border-emerald-500/30 mb-6">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-emerald-400 mt-1" />
              <div className="flex-1">
                <h2 className="text-emerald-200 font-semibold mb-1">
                  Copy this key now - it will not be shown again
                </h2>
                <p className="text-sm text-slate-300 mb-3">
                  Stored prefix: {" "}
                  <span className="font-mono text-slate-200">
                    {freshlyCreated.key_prefix}
                  </span>
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="flex-1 min-w-[200px] p-2 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200 font-mono break-all">
                    {freshlyCreated.key}
                  </code>
                  <Button
                    onClick={copyFreshKey}
                    variant="outline"
                    className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" /> Copy
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => setFreshlyCreated(null)}
                    variant="ghost"
                    className="text-slate-400 hover:text-white"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading your API keys...
          </div>
        )}

        {!loading && error && (
          <Card className="p-4 bg-red-950/20 border-red-800 text-red-300 mb-6">
            {error}
          </Card>
        )}

        {!loading && !error && prefixBlocks.length === 0 && (
          <Card className="p-12 bg-slate-900 border-slate-800 text-center">
            <KeyRound className="w-12 h-12 text-slate-700 mx-auto mb-4" />
            <p className="text-slate-400 mb-4">No API keys yet.</p>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" /> Create your first key
            </Button>
          </Card>
        )}

        {!loading && prefixBlocks.length > 0 && (
          <div className="space-y-3">
            {prefixBlocks.map((item) => (
              <Card
                key={item.id}
                className="p-4 bg-slate-900 border-slate-800 flex items-center justify-between gap-4 flex-wrap"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="p-2 bg-slate-800 rounded">
                    <KeyRound className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-mono truncate">
                      {item.key_prefix}
                      <span className="text-slate-500">...</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      Created {item.created}
                    </div>
                  </div>
                  <Badge className="bg-slate-800 text-slate-300 border-slate-700 font-mono text-xs hidden sm:inline-flex">
                    id: {item.id.slice(0, 8)}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  onClick={() => handleRevoke(item.id)}
                  disabled={revokingId === item.id}
                  className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                >
                  {revokingId === item.id ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  Revoke
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
