import { TypeTag } from "@/components/shared/TypeTag";
import SectionHeader from "./SectionHeader";
import SwatchCard from "./shared/SwatchCard";

const inkScale = [
  { name: "black", variable: "--color-black" },
  { name: "surface", variable: "--color-surface" },
  { name: "elevated", variable: "--color-elevated" },
  { name: "line", variable: "--color-line" },
  { name: "border", variable: "--color-border" },
  { name: "muted", variable: "--color-muted" },
  { name: "primary", variable: "--color-primary" },
  { name: "white", variable: "--color-white" },
];

const brandColors = [
  { name: "accent", variable: "--color-accent" },
  { name: "on-accent", variable: "--color-on-accent" },
  { name: "brand", variable: "--color-brand" },
];

const semanticColors = [
  { name: "success", variable: "--color-success" },
  { name: "error", variable: "--color-error" },
  { name: "warning", variable: "--color-warning" },
  { name: "success-mark", variable: "--color-success-mark" },
  { name: "error-mark", variable: "--color-error-mark" },
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
  { name: "tx-other", variable: "--color-tx-other", type: "TicketCreate" },
];

function SubsectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-4 font-display text-caps uppercase tracking-header text-muted">
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
        {/* Ink Scale */}
        <div>
          <SubsectionLabel>Ink Scale</SubsectionLabel>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-9">
            {inkScale.map((c) => (
              <SwatchCard key={c.name} name={c.name} variable={c.variable} />
            ))}
          </div>
        </div>

        {/* Brand */}
        <div>
          <SubsectionLabel>Accent (Coral)</SubsectionLabel>
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-9">
            {txColors.map((c) => (
              <div key={c.name} className="space-y-2">
                <div
                  className="h-16 w-full rounded-lg border border-line"
                  style={{ backgroundColor: `var(${c.variable})` }}
                />
                <p className="font-mono text-cell font-medium text-primary">{c.name}</p>
                <TypeTag txType={c.type} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
