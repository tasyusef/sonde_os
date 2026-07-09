import type { Metadata } from "next";
import PageHero from "@/components/shared/PageHero";

export const metadata: Metadata = {
  title: "About Sonde — Independent XRPL Block Explorer & Analytics Platform",
  description:
    "Sonde is an independent XRP Ledger explorer with real-time blockchain data, portfolio tracking, AI-powered analytics, fund tracing, and risk scoring. No ads, no inflated metrics — accurate XRPL data for traders, developers, and analysts.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About Sonde — XRPL Block Explorer, Portfolio Tracker & AI Analytics",
    description:
      "Independent XRP Ledger explorer with live data, portfolio tracking with PnL analysis, AI-powered natural language queries, fund tracing, and risk scoring.",
  },
};

const FEATURES = [
  {
    title: "Live ledger feed",
    desc: "Sonde connects to XRP Ledger nodes via WebSocket for real-time data. Account pages fetch directly from your browser, distributing load across the network.",
  },
  {
    title: "Accurate volume metrics",
    desc: "An ingestion pipeline processes every ledger close, computing hourly and daily rollups for DEX volume, network fees, payment corridors, and token OHLC data. Trade volume counts trades only — no inflated numbers.",
  },
  {
    title: "Token and NFT analytics",
    desc: "OHLC candlestick charts, marketplace volume rankings, holder distribution, AMM pool data, and collection galleries — all sourced from on-ledger activity.",
  },
  {
    title: "Network monitoring",
    desc: "Live fee burns, transaction breakdowns by type, validator amendment tracking, and payment corridor analysis across the XRP Ledger.",
  },
];

export default function AboutPage() {
  return (
    <main>
      <PageHero
        title="About"
        accent="Sonde."
        subtitle="An independent block explorer and analytics platform for the XRP Ledger."
      />

      <div className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        <article className="mx-auto max-w-3xl space-y-16">
          {/* Intro */}
          <p className="font-body text-lg text-secondary leading-relaxed">
            Real-time blockchain data, portfolio tracking, AI-powered
            intelligence, and network analytics — built for traders, developers,
            and analysts who want accurate information without noise.
          </p>

          {/* Why */}
          <section>
            <h2 className="font-display text-heading font-semibold text-primary">
              Why another XRPL explorer?
            </h2>
            <p className="mt-3 font-body text-body text-secondary leading-relaxed">
              Most XRP Ledger explorers count mints as volume, display stale data,
              or bury the information that actually matters. Sonde takes a different
              approach: trade volume means trades only, data comes directly from
              XRPL nodes in real time, and the interface is designed around
              information hierarchy — the most important data is the most visible.
            </p>
          </section>

          {/* Real-time data */}
          <section>
            <h2 className="font-display text-heading font-semibold text-primary">
              Real-time XRPL data
            </h2>
            <div className="mt-4 space-y-3">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-elevated bg-surface px-5 py-4 shadow-card"
                >
                  <h3 className="font-mono text-cell font-medium text-brand">
                    {f.title}
                  </h3>
                  <p className="mt-1 font-body text-ui text-muted leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Portfolio */}
          <section>
            <h2 className="font-display text-heading font-semibold text-primary">
              Portfolio tracking
            </h2>
            <p className="mt-3 font-body text-body text-secondary leading-relaxed">
              Connect your wallet to track your XRP Ledger portfolio in real time.
              Sonde calculates unrealized and realized PnL using weighted-average
              cost basis, monitors your DeFi positions across AMM pools, and
              provides historical portfolio charts with XRP benchmark comparison.
              Export your full activity history as CSV for tax reporting.
            </p>
          </section>

          {/* Intelligence */}
          <section>
            <h2 className="font-display text-heading font-semibold text-primary">
              AI-powered blockchain intelligence
            </h2>
            <p className="mt-3 font-body text-body text-secondary leading-relaxed">
              Sonde&apos;s intelligence layer combines graph database analysis with
              AI to provide tools that go beyond basic block exploration. Trace the
              flow of funds between XRPL accounts, discover shortest paths between
              wallets, assess account risk scores, and ask natural language
              questions about on-ledger activity. Persistent investigation sessions
              let you build context over time as you research accounts and
              transaction patterns.
            </p>
          </section>

          {/* Design philosophy */}
          <section>
            <h2 className="font-display text-heading font-semibold text-primary">
              Design philosophy
            </h2>
            <p className="mt-3 font-body text-body text-secondary leading-relaxed">
              Dense, technical blockchain data can be presented both efficiently and
              beautifully. A clear typographic hierarchy — display type for
              orientation, monospace for data, careful weight and size contrast —
              lets you scan a page and find what matters without reading everything.
              Color is used sparingly: one accent for interactive elements, subtle
              status colors for success and failure, and neutral tones for
              everything else. No ads, no tracking scripts, no third-party
              analytics. The site is the product, not you.
            </p>
          </section>

          {/* Built by */}
          <section>
            <h2 className="font-display text-heading font-semibold text-primary">
              Built by
            </h2>
            <p className="mt-3 font-body text-body text-secondary leading-relaxed">
              Sonde is designed and built by{" "}
              <a
                href="https://timothyali.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                Timothy Ali
              </a>
              , a multidisciplinary designer. Previously co-founded{" "}
              <span className="text-primary">xrp.cafe</span>, an NFT marketplace
              on the XRP Ledger, and{" "}
              <span className="text-primary">Pixel Ape Rowboat Club (PARC)</span>,
              an NFT collection where he served as co-founder and artist. He also
              created the brand identity for{" "}
              <span className="text-primary">First Ledger</span>.
            </p>
            <p className="mt-4 font-body text-body text-secondary leading-relaxed">
              PARC Team 6 always be buildin.
            </p>
          </section>

          {/* What's next */}
          <section>
            <h2 className="font-display text-heading font-semibold text-primary">
              What&apos;s next
            </h2>
            <p className="mt-3 font-body text-body text-secondary leading-relaxed">
              Sonde is actively expanding — deeper analytics, more intelligence
              tools, and a public API for developers building on the XRP Ledger.
              What you see today is the foundation for something much larger.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
