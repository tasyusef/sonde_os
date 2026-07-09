import Link from "next/link";
import { SondeMark, SondeWordmark } from "@/components/shared/SondeLogo";
import { xrplClient } from "@/lib/xrpl-client";

const explorerLinks = [
  { href: "/", label: "Home" },
  { href: "/markets", label: "Markets" },
  { href: "/nft", label: "NFTs" },
  { href: "/network", label: "Network" },
  { href: "/asktheledger", label: "Ask the Ledger" },
  { href: "/portfolio", label: "Portfolio" },
  // Research temporarily offline (2026-05-02, until further notice)
];

const productLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
  { href: "/support", label: "Support" },
];

const resourceLinks = [
  { href: "https://xrpl.org", label: "XRPL.org" },
  { href: "https://docs.honeycluster.io/en/welcome/about", label: "Honeycluster Docs" },
  { href: "https://xrpl.org/docs", label: "XRPL Dev Docs" },
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

export function Footer() {
  return (
    <footer className="border-t border-brand/20 bg-brand/5">
      <div className="mx-auto max-w-container px-6 py-12 md:pl-24 sm:py-16">
        {/* Main Grid */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-5 sm:gap-12">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-lg"
            >
              <SondeMark size={20} className="text-brand" />
              <SondeWordmark height={15} className="text-primary" />
            </Link>
            <p className="mt-3 max-w-xs font-body text-cell text-secondary">
              Real-time intelligence and<br />analytics for the XRP Ledger.
            </p>
          </div>

          {/* Explorer */}
          <div>
            <h3 className="mb-3 font-display text-tag font-medium uppercase tracking-header text-muted">
              Explorer
            </h3>
            <ul className="space-y-2">
              {explorerLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="font-body text-cell text-secondary transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Product */}
          <div>
            <h3 className="mb-3 font-display text-tag font-medium uppercase tracking-header text-muted">
              Product
            </h3>
            <ul className="space-y-2">
              {productLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="font-body text-cell text-secondary transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="mb-3 font-display text-tag font-medium uppercase tracking-header text-muted">
              Resources
            </h3>
            <ul className="space-y-2">
              {resourceLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-body text-cell text-secondary transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
                  >
                    {link.label}
                    <ExternalIcon />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Network + Built With */}
          <div>
            <h3 className="mb-3 font-display text-tag font-medium uppercase tracking-header text-muted">
              Network
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span className="font-mono text-cell text-secondary">
                  XRPL Mainnet
                </span>
              </div>
              <p className="font-mono text-cell text-muted">
                WebSocket via {xrplClient.activeNode}
              </p>
            </div>

            <h3 className="mb-3 mt-6 font-display text-tag font-medium uppercase tracking-header text-muted">
              Designed & Built By
            </h3>
            <a
              href="https://timothyali.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-cell text-secondary transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
            >
              Timothy Ali
              <ExternalIcon />
            </a>
            <p className="mt-2 font-mono text-cell text-muted">
              With help from PARC Team 6 and other XRPL community members
            </p>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-elevated pt-6 sm:flex-row">
          <p className="font-mono text-label text-muted">
            &copy; {new Date().getFullYear()} Sonde. All rights reserved.
          </p>

          {/* Social Links */}
          <div className="flex items-center gap-4">
            <a
              href="https://x.com/sonde_xrpl"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
              aria-label="X (Twitter)"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
