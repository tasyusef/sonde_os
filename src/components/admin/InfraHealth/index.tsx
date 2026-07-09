"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type DbStatus = "healthy" | "error" | "disconnected";

interface TableInfo {
  name: string;
  size?: string;
  rows?: number;
}

interface PostgresHealth {
  status: DbStatus;
  error?: string;
  connections: number;
  dbSize: string;
  topTables: TableInfo[];
}

interface ClickHouseHealth {
  status: DbStatus;
  error?: string;
  totalDisk: string;
  tables: TableInfo[];
}

interface HealthData {
  postgres: PostgresHealth;
  clickhouse: ClickHouseHealth;
  lastIngestedLedger: number | null;
  chainTipLedger: number | null;
  chainTipUpdatedAt: string | null;
  lagLedgers: number | null;
}

/* ------------------------------------------------------------------ */
/*  Ingester lag tiers                                                 */
/* ------------------------------------------------------------------ */

// XRPL closes a ledger every ~4s. Live runner normally hovers ~7-8
// ledgers behind tip (~30s). A few hundred ledgers behind = a real
// minutes-long stall worth eyeing. Tens of thousands = serious outage.
function lagTier(lagLedgers: number | null): {
  label: string;
  tone: "ok" | "warn" | "error" | "muted";
} {
  if (lagLedgers == null) return { label: "Unknown", tone: "muted" };
  if (lagLedgers < 0) return { label: "Ahead of tip (??)", tone: "warn" };
  if (lagLedgers <= 30) return { label: "Healthy", tone: "ok" };
  if (lagLedgers <= 300) return { label: "Mild lag", tone: "warn" };
  return { label: "Stalled", tone: "error" };
}

function formatLagSeconds(lagLedgers: number | null): string {
  if (lagLedgers == null || lagLedgers < 0) return "—";
  const seconds = lagLedgers * 4;
  if (seconds < 60) return `~${seconds}s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `~${Math.round(seconds / 3600)}h`;
  return `~${Math.round(seconds / 86_400)}d`;
}

/* ------------------------------------------------------------------ */
/*  Formatters                                                         */
/* ------------------------------------------------------------------ */

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/* ------------------------------------------------------------------ */
/*  Status indicator                                                   */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<
  DbStatus,
  { dot: string; border: string; label: string }
> = {
  healthy: {
    dot: "bg-success",
    border: "border-success/30",
    label: "Healthy",
  },
  error: {
    dot: "bg-error",
    border: "border-error/30",
    label: "Error",
  },
  disconnected: {
    dot: "bg-warning",
    border: "border-warning/30",
    label: "Disconnected",
  },
};

function StatusDot({ status }: { status: DbStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-block h-2 w-2 rounded-full", cfg.dot)} />
      <span className="font-mono text-label text-muted">{cfg.label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Table rows helper                                                  */
/* ------------------------------------------------------------------ */

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="font-mono text-label text-muted">{label}</span>
      <span className="font-mono text-cell tabular-nums text-primary">
        {typeof value === "number" ? fmtNum(value) : value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function InfraHealth() {
  const { data, isLoading, isValidating } = useSWR<HealthData>(
    "/api/admin/health",
    fetcher,
    { dedupingInterval: 30_000, revalidateOnFocus: true },
  );

  const loading = isLoading || isValidating;
  const pg = data?.postgres;
  const ch = data?.clickhouse;

  return (
    <section>
      <h2 className="mb-4 font-display text-heading font-semibold text-primary">
        Infrastructure Health
      </h2>

      <div
        className={cn(
          "grid grid-cols-1 gap-4 lg:grid-cols-2 transition-opacity",
          loading ? "opacity-40" : "opacity-100",
        )}
      >
        {/* Postgres */}
        <div
          className={cn(
            "rounded-xl border bg-surface p-4 shadow-card",
            pg ? STATUS_CONFIG[pg.status].border : "border-elevated",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="font-display text-label font-bold uppercase tracking-header text-brand">
              Postgres
            </span>
            <StatusDot status={pg?.status ?? "disconnected"} />
          </div>
          <div className="space-y-0.5">
            <MetricRow label="Connections" value={pg?.connections ?? "---"} />
            <MetricRow label="DB Size" value={pg?.dbSize ?? "---"} />
          </div>
          {pg?.topTables && pg.topTables.length > 0 && (
            <div className="mt-3 border-t border-elevated pt-2">
              <p className="mb-1 font-mono text-label text-muted">
                Top Tables
              </p>
              {pg.topTables.map((t) => (
                <div
                  key={t.name}
                  className="flex items-center justify-between py-0.5"
                >
                  <span className="font-mono text-cell text-primary">
                    {t.name}
                  </span>
                  <span className="font-mono text-cell tabular-nums text-muted">
                    {t.size ?? "---"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ClickHouse */}
        <div
          className={cn(
            "rounded-xl border bg-surface p-4 shadow-card",
            ch ? STATUS_CONFIG[ch.status].border : "border-elevated",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="font-display text-label font-bold uppercase tracking-header text-brand">
              ClickHouse
            </span>
            <StatusDot status={ch?.status ?? "disconnected"} />
          </div>
          {ch?.error && (
            <p className="mb-2 font-mono text-cell text-error">{ch.error}</p>
          )}
          <div className="space-y-0.5">
            <MetricRow label="Total Disk" value={ch?.totalDisk ?? "---"} />
          </div>
          {ch?.tables && ch.tables.length > 0 && (
            <div className="mt-3 border-t border-elevated pt-2">
              <p className="mb-1 font-mono text-label text-muted">
                Table Row Counts
              </p>
              {ch.tables.map((t) => (
                <div
                  key={t.name}
                  className="flex items-center justify-between py-0.5"
                >
                  <span className="font-mono text-cell text-primary">
                    {t.name}
                  </span>
                  <span className="font-mono text-cell tabular-nums text-muted">
                    {t.rows != null ? fmtNum(t.rows) : "---"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Live ingester pointer + lag from chain tip */}
      {data?.lastIngestedLedger != null && (() => {
        const tier = lagTier(data.lagLedgers ?? null);
        const dotClass =
          tier.tone === "ok"
            ? "bg-success"
            : tier.tone === "warn"
              ? "bg-tx-amm"
              : tier.tone === "error"
                ? "bg-error"
                : "bg-muted";
        const borderClass =
          tier.tone === "ok"
            ? "border-success/30"
            : tier.tone === "warn"
              ? "border-tx-amm/30"
              : tier.tone === "error"
                ? "border-error/30"
                : "border-elevated";
        return (
          <div
            className={cn(
              "mt-4 rounded-xl border bg-surface p-4 shadow-card",
              borderClass,
            )}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-label font-bold uppercase tracking-header text-brand">
                Live Ingester
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("inline-block h-2 w-2 rounded-full", dotClass)}
                />
                <span className="font-mono text-label text-muted">
                  {tier.label}
                </span>
              </span>
            </div>
            <div className="grid grid-cols-1 gap-y-0.5 sm:grid-cols-3 sm:gap-x-4">
              <MetricRow
                label="Last Ingested"
                value={`#${data.lastIngestedLedger.toLocaleString()}`}
              />
              <MetricRow
                label="Chain Tip"
                value={
                  data.chainTipLedger != null
                    ? `#${data.chainTipLedger.toLocaleString()}`
                    : "—"
                }
              />
              <MetricRow
                label="Lag"
                value={
                  data.lagLedgers != null
                    ? `${data.lagLedgers.toLocaleString()} ledgers (${formatLagSeconds(data.lagLedgers)})`
                    : "—"
                }
              />
            </div>
          </div>
        );
      })()}
    </section>
  );
}

export default InfraHealth;
