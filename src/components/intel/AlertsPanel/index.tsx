"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import Toggle from "@/components/shared/Toggle";
import Button from "@/components/shared/Button";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import CreateRuleForm, { TYPE_COLORS } from "./CreateRuleForm";

/* ── Types ── */

interface AlertRule {
  id: number;
  userAddress: string;
  type: string;
  conditionsJson: Record<string, unknown> | null;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

interface HistoryEntry {
  id: number;
  ruleId: number;
  type: string;
  triggeredAt: string;
  payload: { message?: string; [key: string]: unknown } | null;
  status: string;
}

type PresetKey = "watchlist_activity" | "anomaly_spike" | "whale_movement" | "token_health_drop" | "smart_money_trade";

function ruleDescription(rule: AlertRule): string {
  const c = rule.conditionsJson;
  switch (rule.type) {
    case "watchlist_activity": {
      const addrs = (c?.addresses as string[]) ?? [];
      return addrs.length > 0 ? `Watching ${addrs.length} address${addrs.length > 1 ? "es" : ""}` : "All watchlist addresses";
    }
    case "anomaly_spike":
      return "Any significant+ anomaly";
    case "whale_movement":
      return c?.currency ? `${c.currency} / ${String(c.issuer ?? "").slice(0, 8)}...` : "No token set";
    case "token_health_drop": {
      const threshold = Number(c?.threshold) || 50;
      return c?.currency ? `${c.currency} below ${threshold}` : "No token set";
    }
    case "smart_money_trade": {
      const addrs = (c?.addresses as string[]) ?? [];
      const dir = (c?.direction as string) ?? "any";
      return addrs.length > 0 ? `${addrs.length} wallet${addrs.length > 1 ? "s" : ""} (${dir})` : "No wallet set";
    }
    default:
      return rule.type.replace(/_/g, " ");
  }
}

/* ── Main component ── */

export default function AlertsPanel() {
  const [tab, setTab] = useState<"rules" | "history">("rules");
  const [creatingType, setCreatingType] = useState<PresetKey | null>(null);

  const { data: rulesData, mutate: mutateRules } = useSWR<{ rules: AlertRule[] }>(
    "/api/intel/alerts",
    (url: string) => fetch(url).then((r) => r.ok ? r.json() : { rules: [] }),
    { dedupingInterval: 10_000 },
  );

  const { data: historyData } = useSWR<{ alerts: HistoryEntry[] }>(
    tab === "history" ? "/api/intel/alerts/history?limit=30" : null,
    (url: string) => fetch(url).then((r) => r.ok ? r.json() : { alerts: [] }),
    { dedupingInterval: 15_000 },
  );

  const rules = rulesData?.rules ?? [];
  const history = historyData?.alerts ?? [];

  const toggleRule = useCallback(async (id: number, enabled: boolean) => {
    await fetch("/api/intel/alerts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, enabled }) });
    mutateRules();
  }, [mutateRules]);

  const deleteRule = useCallback(async (id: number) => {
    await fetch("/api/intel/alerts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    mutateRules();
  }, [mutateRules]);

  const createRule = useCallback(async (type: string, conditions: Record<string, unknown>) => {
    await fetch("/api/intel/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, conditions }) });
    setCreatingType(null);
    mutateRules();
  }, [mutateRules]);

  return (
    <div className="flex flex-col gap-4">
      {/* Tab toggle */}
      <div className="flex items-center justify-between">
        <Toggle
          options={[
            { value: "rules" as const, label: "Rules" },
            { value: "history" as const, label: "History" },
          ]}
          active={tab}
          onChange={setTab}
        />
        {tab === "rules" && !creatingType && (
          <Button onClick={() => setCreatingType("watchlist_activity")} variant="primary" size="sm">
            + New Alert
          </Button>
        )}
      </div>

      {/* Create new rule */}
      {creatingType && (
        <CreateRuleForm creatingType={creatingType} setCreatingType={setCreatingType} onSubmit={createRule} />
      )}

      {/* Rules list */}
      {tab === "rules" && !creatingType && (
        rules.length === 0 ? (
          <p className="py-8 text-center font-mono text-cell text-muted">
            No alert rules configured. Create one to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="flex flex-col gap-2 rounded-lg border border-elevated px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-mono text-label font-semibold", TYPE_COLORS[rule.type] ?? "text-muted")}>
                    {rule.type.replace(/_/g, " ")}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => toggleRule(rule.id, !rule.enabled)}
                      className={cn(
                        "rounded-full px-2 py-0.5 font-mono text-tag font-medium transition-colors",
                        rule.enabled ? "bg-success/10 text-success" : "bg-elevated text-muted",
                      )}
                    >
                      {rule.enabled ? "On" : "Off"}
                    </button>
                    <Button
                      onClick={() => deleteRule(rule.id)}
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label="Delete rule"
                      className="hover:text-error hover:bg-error/10"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </Button>
                  </div>
                </div>
                <div className="min-w-0">
                  <span className="font-mono text-cell text-primary">{ruleDescription(rule)}</span>
                  <span className="ml-2 font-mono text-tag text-muted">
                    {rule.lastTriggeredAt ? `Last: ${timeAgo(rule.lastTriggeredAt)}` : "Never triggered"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* History list */}
      {tab === "history" && (
        history.length === 0 ? (
          <p className="py-8 text-center font-mono text-cell text-muted">No alert history yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-2 rounded-lg border border-elevated px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-mono text-label font-semibold", TYPE_COLORS[entry.type] ?? "text-muted")}>
                    {entry.type.replace(/_/g, " ")}
                  </span>
                  <span className={cn(
                    "shrink-0 rounded-tag px-2 py-0.5 font-mono text-tag font-medium",
                    entry.status === "delivered" ? "bg-success/10 text-success" : entry.status === "failed" ? "bg-error/10 text-error" : "bg-elevated text-muted",
                  )}>
                    {entry.status}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-cell text-primary truncate">
                    {entry.payload?.message ?? entry.type.replace(/_/g, " ")}
                  </p>
                  <span className="font-mono text-tag text-muted">{timeAgo(entry.triggeredAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
