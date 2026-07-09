import Link from "next/link";
import PageHero from "@/components/shared/PageHero";
import { EXAMPLE_QUESTIONS } from "@/lib/intel-schemas";
import AskTheLedgerFaq from "./AskTheLedgerFaq";

/**
 * Landing for signed-in non-Pro users on /asktheledger.
 *
 * They've already converted on identity (signed in) — the goal here is
 * to explain the value clearly and drive to /pricing for upgrade.
 */
export default function FreeHero() {
  return (
    <main>
      <PageHero
        title="Ask the"
        accent="Ledger"
        subtitle="Natural-language queries over the entire XRP Ledger. Ask anything in plain English — get charts, tables, and answers."
        showDataWindow
      />

      <div className="mx-auto max-w-container px-4 pb-16 sm:px-6">
        <section
          aria-labelledby="upgrade-heading"
          className="rounded-2xl border border-elevated bg-surface p-6 shadow-card sm:p-8"
        >
          <h2
            id="upgrade-heading"
            className="font-display text-tag uppercase tracking-header text-muted"
          >
            What you can ask
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <span
                key={q}
                className="rounded-lg border border-elevated bg-elevated/50 px-3 py-2 font-body text-cell text-secondary"
              >
                {q}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-start gap-4 border-t border-elevated pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-h3 text-primary">
                Upgrade to Pro to ask
              </p>
              <p className="mt-1 font-body text-cell text-muted">
                Pro is $5/mo — includes unlimited queries, charts, history,
                investigation tools, alerts, and more.
              </p>
            </div>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 font-display text-ui font-semibold text-white transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              See pricing
            </Link>
          </div>
        </section>

        <AskTheLedgerFaq />
      </div>
    </main>
  );
}
