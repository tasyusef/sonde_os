"use client";

import SectionHeader from "./SectionHeader";

const fontFamilies = [
  {
    name: "Satoshi",
    class: "font-display",
    variable: "--font-display",
    usage: "Headings, navigation, display text, logo wordmark",
  },
  {
    name: "DM Sans",
    class: "font-body",
    variable: "--font-body",
    usage: "Body text, descriptions, search inputs",
  },
  {
    name: "Geist Mono",
    class: "font-mono",
    variable: "--font-mono",
    usage: "Data: addresses, hashes, amounts, table content, labels, tags",
  },
];

const typeScale = [
  { token: "text-display-lg", size: "56px", sample: "Display Large" },
  { token: "text-display", size: "36px", sample: "Display" },
  { token: "text-title", size: "25px", sample: "Page Title" },
  { token: "text-heading", size: "21px", sample: "Section Heading" },
  { token: "text-value", size: "17px", sample: "Metric Value" },
  { token: "text-lg", size: "15px", sample: "Larger Body Text" },
  { token: "text-body", size: "14px", sample: "Body text and descriptions" },
  { token: "text-ui", size: "14px", sample: "Nav items, secondary data" },
  { token: "text-cell", size: "12px", sample: "rPEPPER7kf...c6GDY" },
  { token: "text-tag", size: "12px", sample: "TRANSACTION TYPE TAG" },
  { token: "text-label", size: "12px", sample: "BADGE LABEL" },
  { token: "text-micro", size: "10px", sample: "NOTIFICATION 3" },
];

const trackingTokens = [
  { token: "tracking-header", value: "1.5px", sample: "UPPERCASE LABEL" },
  { token: "tracking-pill", value: "1px", sample: "PERIOD TOGGLE" },
  { token: "tracking-nav", value: "0.3px", sample: "Navigation Link" },
  { token: "tracking-display", value: "-1px", sample: "Display Heading" },
];

function SubsectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-4 font-display text-tag uppercase tracking-header text-muted">
      {children}
    </h3>
  );
}

export default function TypographySection() {
  return (
    <section id="typography" className="scroll-mt-20">
      <SectionHeader
        title="Typography"
        subtitle="Three font families, twelve semantic sizes, four tracking tokens."
      />

      <div className="space-y-10">
        {/* Font Families */}
        <div>
          <SubsectionLabel>Font Families</SubsectionLabel>
          <div className="space-y-6">
            {fontFamilies.map((f) => (
              <div
                key={f.name}
                className="rounded-2xl border border-elevated bg-surface p-5 shadow-card"
              >
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="font-mono text-cell font-medium text-brand">
                    {f.class}
                  </span>
                  <span className="font-mono text-label text-muted">{f.variable}</span>
                </div>
                <p className={`${f.class} text-heading text-primary`}>
                  The quick brown fox jumps over the lazy dog
                </p>
                <p className="mt-2 font-body text-cell text-secondary">{f.usage}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Type Scale */}
        <div>
          <SubsectionLabel>Type Scale</SubsectionLabel>
          <div className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card">
            {typeScale.map((t, i) => (
              <div
                key={t.token}
                className={`flex items-baseline gap-4 px-5 py-4 ${i < typeScale.length - 1 ? "border-b border-elevated" : ""}`}
              >
                <span className="w-32 shrink-0 font-mono text-cell text-brand">
                  {t.token}
                </span>
                <span className={`${t.token} flex-1 truncate font-display text-primary`}>
                  {t.sample}
                </span>
                <span className="shrink-0 font-mono text-label text-muted tabular-nums">
                  {t.size}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Tracking */}
        <div>
          <SubsectionLabel>Letter Spacing</SubsectionLabel>
          <div className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card">
            {trackingTokens.map((t, i) => (
              <div
                key={t.token}
                className={`flex items-center gap-4 px-5 py-4 ${i < trackingTokens.length - 1 ? "border-b border-elevated" : ""}`}
              >
                <span className="w-40 shrink-0 font-mono text-cell text-brand">
                  {t.token}
                </span>
                <span
                  className={`flex-1 font-display text-body text-primary`}
                  style={{ letterSpacing: t.value }}
                >
                  {t.sample}
                </span>
                <span className="shrink-0 font-mono text-label text-muted tabular-nums">
                  {t.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Leading */}
        <div>
          <SubsectionLabel>Line Height</SubsectionLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
              <span className="font-mono text-cell text-brand">leading-display</span>
              <span className="ml-2 font-mono text-label text-muted">1.05</span>
              <p className="mt-3 font-display text-heading leading-display text-primary">
                Tight leading for display headings keeps large text compact and impactful
                across multiple lines.
              </p>
            </div>
            <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
              <span className="font-mono text-cell text-brand">body default</span>
              <span className="ml-2 font-mono text-label text-muted">1.6</span>
              <p className="mt-3 font-body text-body text-primary" style={{ lineHeight: 1.6 }}>
                Generous body leading ensures comfortable reading for paragraphs and
                longer form content across the explorer.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
