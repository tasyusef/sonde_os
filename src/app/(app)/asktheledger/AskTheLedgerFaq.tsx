/**
 * Shared FAQ block for the /asktheledger landing surfaces (FreeHero +
 * UnauthHero). Visible on the page AND emitted as schema.org/FAQPage
 * JSON-LD so AI answer engines (Perplexity, ChatGPT search, Gemini)
 * can cite the answers directly when users ask about the feature.
 *
 * Visible content must match the structured-data content per Google's
 * FAQPage guidelines — single source of truth keeps them in sync.
 */

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Ask the Ledger?",
    a: "Ask the Ledger is Sonde's natural-language interface to the XRP Ledger. Type a question in plain English (\"Top 10 tokens by trading volume this week\", \"How much XRP was burned in fees today?\") and it returns the answer as a chart, table, or stat — derived from real on-chain data, not generic LLM knowledge.",
  },
  {
    q: "What kinds of questions can I ask?",
    a: "Anything that can be answered from validated XRPL transactions, account state, token markets, AMM pools, or NFT activity. Time-windowed analytics, top-N rankings, account histories, transaction volume, fee burn, holder distributions, smart-money trends. The query router is read-only — it cannot modify the ledger or execute transactions on your behalf.",
  },
  {
    q: "How does it work under the hood?",
    a: "An LLM translates your question into ClickHouse SQL against Sonde's indexed XRPL data, executes it, then formats the rows into the most useful presentation (chart, stat, table, or prose summary). Every answer has an expandable detail showing the exact SQL that was run, so you can verify or learn from the query.",
  },
  {
    q: "How current is the data?",
    a: "Live. Every validated XRPL transaction is indexed within seconds of a ledger close. \"All-time\" rankings and aggregations cover the period since Sonde began continuously indexing the XRPL in June 2025 (~11 months as of May 2026). Older XRPL history isn't available yet.",
  },
  {
    q: "Is it free?",
    a: "Ask the Ledger is a Pro feature. Sonde Pro is $4–5/month and includes managed AI access plus the rest of the intelligence layer (account graphs, fund tracing, smart-money detail, alerts, whale activity). Power users can also bring their own Anthropic, Google, or OpenAI API key (BYOK) to bypass the managed-AI rate limit.",
  },
  {
    q: "How accurate are the answers?",
    a: "The numbers are exact — they come from the same indexed XRPL data the rest of Sonde uses. The LLM occasionally misinterprets ambiguous questions or chooses a different aggregation than you intended; in those cases you can rephrase, or expand the answer to inspect the SQL and re-run a tweaked version.",
  },
  {
    q: "Where can I see my past conversations?",
    a: "Every Q+A is saved to your account and shown in the History rail next to the chat. Click any entry to reload that conversation; you can keep asking from there.",
  },
];

export default function AskTheLedgerFaq() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section
        aria-labelledby="asktheledger-faq-heading"
        className="mt-8 rounded-2xl border border-elevated bg-surface p-6 shadow-card sm:p-8"
      >
        <h2
          id="asktheledger-faq-heading"
          className="font-display text-tag uppercase tracking-header text-muted"
        >
          Frequently asked
        </h2>
        <dl className="mt-4 divide-y divide-elevated">
          {FAQ.map(({ q, a }, i) => (
            <div key={i} className="py-4 first:pt-0 last:pb-0">
              <dt className="font-display text-ui font-semibold text-primary">
                {q}
              </dt>
              <dd className="mt-2 font-body text-cell leading-relaxed text-secondary">
                {a}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
