"use client";

import { useState } from "react";
import type { MarketingData } from "./types";
import MarketingCardGrid from "./CardGrid";
import MarketingDataExport from "./DataExport";

export function Marketing() {
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runExport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/marketing/data", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MarketingData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h2 className="mb-1 font-display text-heading font-semibold text-primary">
        Marketing
      </h2>
      <p className="mb-6 font-body text-ui text-muted">
        Screenshot-ready card previews and fresh on-chain data for social posts.
      </p>
      <div className="space-y-6">
        <MarketingCardGrid data={data} />
        <MarketingDataExport
          data={data}
          loading={loading}
          error={error}
          onFetch={runExport}
        />
      </div>
    </section>
  );
}

export default Marketing;
