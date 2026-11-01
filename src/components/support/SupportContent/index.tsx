import { useState } from "react";
import { Link } from "react-router";
import Collapse from "@/components/shared/Collapse";
import PixelIcon from "@/components/shared/PixelIcon";
import Section from "@/components/shared/Section";

/* ── FAQ ── */

const faq: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Sonde?",
    a: "Sonde is a free XRPL block explorer. Look up any account, transaction, token, NFT or ledger, and watch new ledgers close in real time. All data comes straight from the XRP Ledger.",
  },
  {
    q: "Where does Sonde get its data?",
    a: "Sonde connects directly to XRPL mainnet nodes over WebSocket. The XRP price comes from Bitstamp, with CoinGecko or CoinPaprika for supply and volume; the price chart falls back to Kraken if Bitstamp is down.",
  },
  {
    q: "Why do some transactions show as failed?",
    a: "A transaction succeeds only when its result code (meta.TransactionResult) is tesSUCCESS. Any other code means the transaction was included in a ledger but didn’t take effect. The fee is still charged.",
  },
  {
    q: "Why does my account show as not found?",
    a: (
      <>
        Either the address has a typo, or the account isn’t activated on XRPL
        mainnet yet. An account is activated when it first receives at least
        the base reserve (currently 1 XRP). Check that the address starts with
        “r” and is 25 to 35 characters long. The{" "}
        <Link
          to="/docs/accounts-and-keys"
          className="link text-primary"
        >
          Accounts &amp; Keys guide
        </Link>{" "}
        explains activation and reserves.
      </>
    ),
  },
  {
    q: "Can I use Sonde on mobile?",
    a: "Yes. On a phone, use the menu button in the top bar to move between pages, and the search button at the bottom right to look something up. On desktop, the sidebar and the search bar at the top do the same jobs.",
  },
];

function FAQItem({ item }: { item: (typeof faq)[number] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-4 text-left"
      >
        <span className="font-body text-ui font-medium text-primary">
          {item.q}
        </span>
        <PixelIcon
          name={open ? "minus" : "plus"}
          className="shrink-0 text-muted"
        />
      </button>
      <Collapse open={open}>
        <p className="pb-4 font-body text-cell text-primary leading-read-sm">{item.a}</p>
      </Collapse>
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
];

/* ── Main ── */

export default function SupportContent() {
  return (
    <div className="grid items-start gap-16 lg:grid-cols-[minmax(0,1fr)_var(--spacing-rail)]">
      <Section title="Frequently asked questions">
        {faq.map((item) => (
          <FAQItem key={item.q} item={item} />
        ))}
      </Section>

      <Section title="Contact">
        <div className="space-y-3">
          {contacts.map((c) => (
            <a
              key={c.label}
              href={c.href}
              {...(c.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="flex items-center justify-between bg-surface p-4 shadow-card hover:bg-dither"
            >
              <div>
                <p className="font-display text-caps uppercase tracking-header text-muted">
                  {c.label}
                </p>
                <p className="mt-0.5 font-body text-cell text-primary">
                  {c.value}
                </p>
              </div>
              {c.external && <PixelIcon name="external" size="sm" className="opacity-40" />}
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}
