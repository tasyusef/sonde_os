"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";

/* ── FAQ ── */

const faq: { q: string; a: string }[] = [
  {
    q: "What is Sonde?",
    a: "Sonde is a data-dense XRPL block explorer built for power users. It provides real-time ledger data, token analytics, DEX activity, NFT tracking, and network health — all sourced directly from the XRP Ledger.",
  },
  {
    q: "Where does Sonde get its data?",
    a: "Sonde connects directly to XRPL mainnet nodes via WebSocket. Price data comes from CryptoCompare. Volume rankings and token metadata are computed by our own ingestion pipeline — we never inflate volume by counting mints.",
  },
  {
    q: "Why do some transactions show as 'failed'?",
    a: "A transaction is considered successful only when its meta.TransactionResult is 'tesSUCCESS'. Any other result code means the transaction was included in a ledger but did not execute its intended effect.",
  },
  {
    q: "How is NFT / token volume calculated?",
    a: "Sonde counts real trade volume only. For NFTs, we count NFTokenAcceptOffer (matched buy/sell) — not mints or burns. For tokens, we count OfferCreate fills and AMM swaps — not trust line operations.",
  },
  {
    q: "Why does my account show 'Not Found'?",
    a: "The account either doesn't exist on XRPL mainnet, hasn't been activated (needs a 10 XRP reserve), or the address was entered incorrectly. Double-check the 'r' prefix and length.",
  },
  {
    q: "Can I use Sonde on mobile?",
    a: "Yes. The explorer is fully responsive with a bottom navigation dock on mobile and a sidebar on desktop.",
  },
];

function FAQItem({ item }: { item: (typeof faq)[number] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-elevated last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
      >
        <span className="font-body text-ui font-medium text-primary">
          {item.q}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            "shrink-0 text-muted transition-transform duration-200",
            open && "rotate-45"
          )}
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <p className="pb-4 font-body text-cell text-secondary leading-relaxed">
              {item.a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Contact ── */

const contacts = [
  {
    label: "X (Twitter)",
    value: "@sonde_xrpl",
    href: "https://x.com/sonde_xrpl",
    external: true,
  },
  {
    label: "GitHub",
    value: "Report an issue",
    href: "https://github.com/sondelab/sonde/issues",
    external: true,
  },
];

function ExternalIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="opacity-40"
      aria-hidden="true"
    >
      <path d="M7 17L17 7M17 7H7M17 7v10" />
    </svg>
  );
}

/* ── Main ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 font-display text-tag font-medium uppercase tracking-header text-muted">
      {children}
    </h2>
  );
}

export default function SupportContent() {
  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_380px] lg:gap-16">
      {/* Left: FAQ */}
      <section>
        <SectionLabel>Frequently Asked Questions</SectionLabel>
        <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card sm:p-6">
          {faq.map((item) => (
            <FAQItem key={item.q} item={item} />
          ))}
        </div>
      </section>

      {/* Right: Contact */}
      <aside className="space-y-10">
        <section>
          <SectionLabel>Contact</SectionLabel>
          <div className="space-y-3">
            {contacts.map((c) => (
              <a
                key={c.label}
                href={c.href}
                {...(c.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="flex items-center justify-between rounded-xl border border-elevated bg-surface p-4 transition-shadow hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                <div>
                  <p className="font-display text-label uppercase tracking-header text-muted">
                    {c.label}
                  </p>
                  <p className="mt-0.5 font-body text-cell font-medium text-brand">
                    {c.value}
                  </p>
                </div>
                {c.external && <ExternalIcon />}
              </a>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
