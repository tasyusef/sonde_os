"use client";

import SectionHeader from "./SectionHeader";
import SwatchCard from "./shared/SwatchCard";

const slateScale = [
  { name: "black", variable: "--color-black" },
  { name: "surface", variable: "--color-surface" },
  { name: "elevated", variable: "--color-elevated" },
  { name: "border", variable: "--color-border" },
  { name: "muted", variable: "--color-muted" },
  { name: "secondary", variable: "--color-secondary" },
  { name: "primary", variable: "--color-primary" },
  { name: "white", variable: "--color-white" },
];

const brandColors = [
  { name: "brand", variable: "--color-brand" },
  { name: "brand-light", variable: "--color-brand-light" },
  { name: "brand-deep", variable: "--color-brand-deep" },
  { name: "brand-on-light", variable: "--color-brand-on-light" },
];

const semanticColors = [
  { name: "success", variable: "--color-success" },
  { name: "error", variable: "--color-error" },
  { name: "warning", variable: "--color-warning" },
];

const txColors = [
  { name: "tx-payment", variable: "--color-tx-payment", type: "Payment" },
  { name: "tx-offer", variable: "--color-tx-offer", type: "OfferCreate" },
  { name: "tx-nft", variable: "--color-tx-nft", type: "NFTokenMint" },
  { name: "tx-trust", variable: "--color-tx-trust", type: "TrustSet" },
  { name: "tx-amm", variable: "--color-tx-amm", type: "AMMCreate" },
  { name: "tx-escrow", variable: "--color-tx-escrow", type: "EscrowCreate" },
  { name: "tx-account", variable: "--color-tx-account", type: "AccountSet" },
  { name: "tx-check", variable: "--color-tx-check", type: "CheckCreate" },
];

function SubsectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-4 font-display text-tag uppercase tracking-header text-muted">
      {children}
    </h3>
  );
}

export default function ColorSection() {
  return (
    <section id="colors" className="scroll-mt-20">
      <SectionHeader
        title="Color Palette"
        subtitle="All design tokens defined in globals.css via @theme blocks. Values update with the current theme."
      />

      <div className="space-y-10">
        {/* Slate Scale */}
        <div>
          <SubsectionLabel>Slate Scale</SubsectionLabel>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-9">
            {slateScale.map((c) => (
              <SwatchCard key={c.name} name={c.name} variable={c.variable} />
            ))}
          </div>
        </div>

        {/* Brand */}
        <div>
          <SubsectionLabel>Brand (Salmon)</SubsectionLabel>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
            {brandColors.map((c) => (
              <SwatchCard key={c.name} name={c.name} variable={c.variable} />
            ))}
          </div>
        </div>

        {/* Semantic */}
        <div>
          <SubsectionLabel>Semantic</SubsectionLabel>
          <div className="grid grid-cols-3 gap-4">
            {semanticColors.map((c) => (
              <SwatchCard key={c.name} name={c.name} variable={c.variable} />
            ))}
          </div>
        </div>

        {/* Transaction Types */}
        <div>
          <SubsectionLabel>Transaction Types</SubsectionLabel>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {txColors.map((c) => (
              <div key={c.name} className="space-y-2">
                <div
                  className="h-16 w-full rounded-lg border border-elevated"
                  style={{ backgroundColor: `var(${c.variable})` }}
                />
                <p className="font-mono text-cell font-medium text-primary">{c.name}</p>
                <span
                  className="inline-block rounded-tag px-2 py-0.5 font-mono text-tag font-medium"
                  style={{
                    backgroundColor: `color-mix(in srgb, var(${c.variable}) 10%, transparent)`,
                    color: `var(${c.variable})`,
                  }}
                >
                  {c.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
