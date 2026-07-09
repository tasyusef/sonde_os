import Link from "next/link";
import PageHero from "@/components/shared/PageHero";
import { EXAMPLE_QUESTIONS } from "@/lib/intel-schemas";
import AskTheLedgerFaq from "./AskTheLedgerFaq";

/**
 * Landing for unauthenticated users on /asktheledger.
 *
 * Goal: convey what the feature does (natural-language XRPL queries),
 * show example questions to make it concrete, and route to sign-in.
 * Keep it impressionable but not pushy — the chat UI is the actual product.
 */
export default function UnauthHero() {
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
          aria-labelledby="examples-heading"
          className="rounded-2xl border border-elevated bg-surface p-6 shadow-card sm:p-8"
        >
          <h2
            id="examples-heading"
            className="font-display text-tag uppercase tracking-header text-muted"
          >
            What people ask
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
                Sign in to start asking
              </p>
              <p className="mt-1 font-body text-cell text-muted">
                Pro features — included with the $5/mo subscription.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Link
                href="/portfolio"
                className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 font-display text-ui font-semibold text-white transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                Sign in with Xaman
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-lg border border-elevated bg-elevated px-5 py-2.5 font-display text-ui text-primary transition-colors hover:border-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                See pricing
              </Link>
            </div>
          </div>
        </section>

        <AskTheLedgerFaq />
      </div>
    </main>
  );
}
