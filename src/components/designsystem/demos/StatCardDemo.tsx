"use client";

import { useState } from "react";
import StatCard, {
  type StatCardVariant,
  type StatCardValueColor,
} from "@/components/shared/StatCard";
import DemoCard from "../shared/DemoCard";
import { SelectControl, ToggleControl, TextControl } from "../shared/PropControl";

export default function StatCardDemo() {
  const [variant, setVariant] = useState<StatCardVariant>("default");
  const [valueColor, setValueColor] = useState<StatCardValueColor>("primary");
  const [emphasis, setEmphasis] = useState(false);
  const [label, setLabel] = useState("Total Volume");
  const [value, setValue] = useState("8.4M XRP");
  const [sub, setSub] = useState("12,847 trades this week");

  return (
    <div className="space-y-8">
      <DemoCard
        name="StatCard"
        importPath="@/components/shared/StatCard"
        description="Universal stat card. Use anywhere you need a compact label + value in a grid. Two variants: default (bordered + bg-surface) for most cases, elevated (no border + bg-elevated) for sections with semantic coloring like portfolio risk metrics. Set emphasis to use a larger heading size."
        preview={
          <div className="mx-auto max-w-sm">
            <StatCard
              label={label}
              value={value}
              sub={sub || undefined}
              variant={variant}
              valueColor={valueColor}
              emphasis={emphasis}
            />
          </div>
        }
        controls={
          <>
            <SelectControl
              label="variant"
              value={variant}
              options={[
                { value: "default", label: "default" },
                { value: "elevated", label: "elevated" },
              ]}
              onChange={(v) => setVariant(v as StatCardVariant)}
            />
            <SelectControl
              label="valueColor"
              value={valueColor}
              options={[
                { value: "primary", label: "primary" },
                { value: "brand", label: "brand" },
                { value: "success", label: "success" },
                { value: "error", label: "error" },
                { value: "warning", label: "warning" },
                { value: "muted", label: "muted" },
              ]}
              onChange={(v) => setValueColor(v as StatCardValueColor)}
            />
            <TextControl label="label" value={label} onChange={setLabel} />
            <TextControl label="value" value={value} onChange={setValue} />
            <TextControl label="sub" value={sub} onChange={setSub} placeholder="Optional" />
            <ToggleControl label="emphasis" checked={emphasis} onChange={setEmphasis} />
          </>
        }
        code={`<StatCard
  label="${label}"
  value="${value}"${sub ? `\n  sub="${sub}"` : ""}${variant !== "default" ? `\n  variant="${variant}"` : ""}${valueColor !== "primary" ? `\n  valueColor="${valueColor}"` : ""}${emphasis ? "\n  emphasis" : ""}
/>`}
      />

      {/* Grid showcase */}
      <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
        <h4 className="mb-4 font-display text-label font-medium uppercase tracking-header text-muted">
          Grid of stat cards
        </h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Volume 24H" value="8.4M XRP" sub="+12.4% vs yesterday" />
          <StatCard label="Active Wallets" value="42,891" sub="24h unique accounts" />
          <StatCard label="Fee Burn" value="42.8K XRP" valueColor="warning" sub="Total: 1.24M XRP" />
          <StatCard label="MRR" value="$8,440" valueColor="success" emphasis />
        </div>
      </div>
    </div>
  );
}
