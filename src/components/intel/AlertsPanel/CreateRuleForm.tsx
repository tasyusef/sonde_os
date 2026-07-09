"use client";

import { useState } from "react";
import { useIntelligence } from "@/components/intel/IntelligenceContext";
import Button from "@/components/shared/Button";
import { cn } from "@/lib/utils";

type PresetKey = "watchlist_activity" | "anomaly_spike" | "whale_movement" | "token_health_drop" | "smart_money_trade";

export const PRESET_TYPES: { key: PresetKey; name: string; description: string }[] = [
  { key: "watchlist_activity", name: "Watchlist Activity", description: "Alert when a watched address transacts" },
  { key: "anomaly_spike", name: "Anomaly Spike", description: "Alert when a network metric hits significant+ severity" },
  { key: "whale_movement", name: "Whale Movement", description: "Alert when top-10 holder accumulates or distributes" },
  { key: "token_health_drop", name: "Token Health Drop", description: "Alert when token health drops below threshold" },
  { key: "smart_money_trade", name: "Smart Money Trade", description: "Alert when a tracked smart money wallet trades" },
];

export const TYPE_COLORS: Record<string, string> = {
  watchlist_activity: "bg-chart-blue/10 text-chart-blue",
  anomaly_spike: "bg-chart-amber/10 text-chart-amber",
  whale_movement: "bg-brand/10 text-brand",
  token_health_drop: "bg-error/10 text-error",
  smart_money_trade: "bg-success/10 text-success",
};

const INPUT_CLS = "rounded-lg border border-elevated bg-elevated px-3 py-1.5 font-mono text-cell text-primary placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50";

function ConfigForm({
  presetKey,
  onSubmit,
  onCancel,
}: {
  presetKey: PresetKey;
  onSubmit: (conditions: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const { watchlist } = useIntelligence();
  const [currency, setCurrency] = useState("");
  const [issuer, setIssuer] = useState("");
  const [threshold, setThreshold] = useState("50");
  const [smAddress, setSmAddress] = useState("");
  const [smDirection, setSmDirection] = useState<"any" | "buy" | "sell">("any");

  const cancelBtn = <button onClick={onCancel} className="font-mono text-label text-muted hover:text-primary">Cancel</button>;

  switch (presetKey) {
    case "watchlist_activity":
      return (
        <div className="space-y-3">
          <p className="font-body text-cell text-muted">
            This alert will fire when any address in your watchlist transacts.
            {watchlist.length > 0
              ? ` Currently watching ${watchlist.length} address${watchlist.length > 1 ? "es" : ""}.`
              : " Add addresses to your Watchlist tab first."}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => onSubmit({ addresses: watchlist })} disabled={watchlist.length === 0} variant="primary" size="sm">Create</Button>
            {cancelBtn}
          </div>
        </div>
      );

    case "anomaly_spike":
      return (
        <div className="space-y-3">
          <p className="font-body text-cell text-muted">
            Fires when any network metric (TX count, DEX volume, active accounts, fee burn) hits significant or extreme severity.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => onSubmit({})} variant="primary" size="sm">Create</Button>
            {cancelBtn}
          </div>
        </div>
      );

    case "whale_movement":
      return (
        <div className="space-y-3">
          <p className="font-body text-cell text-muted">
            Alert when a top-10 holder accumulates, distributes, or enters/exits the roster.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="Currency (e.g. USD)" aria-label="Currency code" className={INPUT_CLS} />
            <input type="text" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuer (rAddress)" aria-label="Issuer address" className={INPUT_CLS} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => onSubmit({ currency: currency.trim(), issuer: issuer.trim() })} disabled={!currency.trim() || !issuer.trim()} variant="primary" size="sm">Create</Button>
            {cancelBtn}
          </div>
        </div>
      );

    case "token_health_drop":
      return (
        <div className="space-y-3">
          <p className="font-body text-cell text-muted">
            Alert when a token&apos;s health score drops below your threshold.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="Currency" aria-label="Currency code" className={INPUT_CLS} />
            <input type="text" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuer (rAddress)" aria-label="Issuer address" className={INPUT_CLS} />
            <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Threshold" min={1} max={100} aria-label="Health score threshold" className={INPUT_CLS} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => onSubmit({ currency: currency.trim(), issuer: issuer.trim(), threshold: Number(threshold) || 50 })} disabled={!currency.trim() || !issuer.trim()} variant="primary" size="sm">Create</Button>
            {cancelBtn}
          </div>
        </div>
      );

    case "smart_money_trade":
      return (
        <div className="space-y-3">
          <p className="font-body text-cell text-muted">
            Get notified when a smart money wallet makes a DEX trade.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={smAddress} onChange={(e) => setSmAddress(e.target.value)} placeholder="Wallet address (rAddress)" aria-label="Smart money wallet address" className={INPUT_CLS} />
            <select value={smDirection} onChange={(e) => setSmDirection(e.target.value as "any" | "buy" | "sell")} aria-label="Trade direction filter" className={INPUT_CLS}>
              <option value="any">Any direction</option>
              <option value="buy">Buys only</option>
              <option value="sell">Sells only</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => onSubmit({ addresses: [smAddress.trim()], direction: smDirection })} disabled={!smAddress.trim()} variant="primary" size="sm">Create</Button>
            {cancelBtn}
          </div>
        </div>
      );
  }
}

export default function CreateRuleForm({
  creatingType,
  setCreatingType,
  onSubmit,
}: {
  creatingType: PresetKey;
  setCreatingType: (t: PresetKey | null) => void;
  onSubmit: (type: string, conditions: Record<string, unknown>) => void;
}) {
  return (
    <div className="rounded-2xl border border-elevated bg-surface p-4 shadow-card space-y-3">
      {/* Type selector */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_TYPES.map((preset) => (
          <button
            key={preset.key}
            onClick={() => setCreatingType(preset.key)}
            className={cn(
              "rounded-full px-2.5 py-0.5 font-mono text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
              creatingType === preset.key ? TYPE_COLORS[preset.key] : "text-muted hover:text-secondary",
            )}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <ConfigForm
        key={creatingType}
        presetKey={creatingType}
        onSubmit={(conditions) => onSubmit(creatingType, conditions)}
        onCancel={() => setCreatingType(null)}
      />
    </div>
  );
}
