import SectionHeader from "./SectionHeader";

const fontFamilies = [
  {
    name: "PARC Pixel",
    class: "font-display",
    variable: "--font-display",
    usage: "Headings, navigation, display text. Caps only: never case-sensitive data",
  },
  {
    name: "Departure Mono",
    class: "font-body",
    variable: "--font-body",
    usage: "Body text, descriptions, search inputs",
  },
  {
    name: "Departure Mono",
    class: "font-mono",
    variable: "--font-mono",
    usage: "Data: addresses, hashes, amounts, table content, labels, tags",
  },
];

const typeScale = [
  { token: "text-display-lg", size: "55px / 56px", sample: "Display Large" },
  { token: "text-display", size: "41.25px / 48px", sample: "Display" },
  { token: "text-figure-lg", size: "55px / 56px", sample: "1,234.56", mono: true },
  { token: "text-figure", size: "33px / 40px", sample: "1,234.56", mono: true },
  { token: "text-title", size: "27.5px / 32px", sample: "Page Title" },
  { token: "text-heading", size: "20.625px / 24px", sample: "Section Heading" },
  { token: "text-value", size: "22px / 32px", sample: "Metric Value" },
  { token: "text-lg", size: "16.5px / 24px", sample: "Larger Body Text" },
  { token: "text-body", size: "16.5px / 24px", sample: "Body text and descriptions" },
  { token: "text-ui", size: "11px / 16px", sample: "Nav items, secondary data" },
  { token: "text-cell", size: "11px / 16px", sample: "rPEPPER7kf...c6GDY" },
  { token: "text-tag", size: "11px / 16px", sample: "TRANSACTION TYPE TAG" },
  { token: "text-label", size: "11px / 16px", sample: "BADGE LABEL" },
  { token: "text-micro", size: "11px / 16px", sample: "NOTIFICATION 3" },
];

const trackingTokens = [
  { token: "tracking-header", value: "0", sample: "UPPERCASE LABEL" },
  { token: "tracking-pill", value: "0", sample: "PERIOD TOGGLE" },
  { token: "tracking-nav", value: "0", sample: "Navigation Link" },
  { token: "tracking-display", value: "0", sample: "Display Heading" },
];

function SubsectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-4 font-display text-caps uppercase tracking-header text-muted">
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
                className="rounded-2xl border border-line bg-surface p-5 shadow-card"
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
                <p className="mt-2 font-body text-cell text-primary">{f.usage}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Type Scale */}
        <div>
          <SubsectionLabel>Type Scale</SubsectionLabel>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {typeScale.map((t, i) => (
              <div
                key={t.token}
                className={`flex items-baseline gap-4 px-5 py-4 ${i < typeScale.length - 1 ? "border-b border-line" : ""}`}
              >
                <span className="w-32 shrink-0 font-mono text-cell text-brand">
                  {t.token}
                </span>
                <span
                  className={`${t.token} flex-1 truncate text-primary ${"mono" in t ? "font-mono" : "font-display"}`}
                >
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
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {trackingTokens.map((t, i) => (
              <div
                key={t.token}
                className={`flex items-center gap-4 px-5 py-4 ${i < trackingTokens.length - 1 ? "border-b border-line" : ""}`}
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
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <span className="font-mono text-cell text-brand">leading-read-sm</span>
              <span className="ml-2 font-mono text-label text-muted">20px</span>
              <p className="mt-3 font-body text-cell leading-read-sm text-primary">
                Small reading paragraphs (tips, card descriptions) open up from 16px to
                20px, still on whole pixels.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <span className="font-mono text-cell text-brand">leading-read</span>
              <span className="ml-2 font-mono text-label text-muted">28px</span>
              <p className="mt-3 font-body text-body leading-read text-primary">
                Body paragraphs on the about and docs pages read at 28px. Everything else
                takes its size&apos;s own line height.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
